// Use-cases de lectura financiera. Devuelven DTOs con montos en unidad mayor (number) listos para
// la UI. Filtran por userId (ownership). Los presupuestos/categorías se asumen en CLP (base).
import type {
  Account,
  AccountRepository,
  BankRepository,
  BudgetRepository,
  Category,
  CategoryRepository,
  Transaction,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts";
import { NotOwnerError, CategoryNotFoundError } from "../../domain/finance/finance.domain.ts";
import { Money } from "../../domain/finance/money.ts";
import {
  computeActiveCash,
  computeNetPosition,
  computeOverdraftDebt,
  creditCardDebts,
  computeCategoryUsage,
  categoryStatus,
} from "./budget-formulas.ts";

const CLP = "CLP" as const;

export type MonthlySummaryDTO = {
  activeCash: number;
  netPosition: number;
  overdraftDebt: number;
  creditCardDebts: { accountId: string; name: string; debt: number }[];
  income: number;
  expense: number;
  totalBudget: number;
};

export type AccountDTO = {
  id: string;
  bankId: string;
  bankName: string;
  name: string;
  accountType: string;
  currency: string;
  balance: number;
  color: string | null;
};

export type TransactionDTO = {
  id: string;
  description: string;
  amount: number;
  direction: string;
  date: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  remaining: number | null; // histórico: lo que quedaba de la categoría justo tras este movimiento
};

export type CategoryDTO = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  limit: number;
  used: number;
  available: number;
  status: string;
};

export type BudgetViewDTO = { budgetId: string | null; categories: CategoryDTO[] };

function txToDTO(t: Transaction, cat: Category | undefined, remaining: number | null = null): TransactionDTO {
  return {
    id: t.id,
    description: t.description,
    amount: t.amount.toMajor(),
    direction: t.direction,
    date: t.date.toISOString(),
    categoryId: t.categoryId,
    categoryName: cat?.name ?? null,
    categoryIcon: cat?.icon ?? null,
    categoryColor: cat?.color ?? null,
    remaining,
  };
}

// "Quedan" histórico: recorre los gastos (débito) de más antiguo a más nuevo acumulando por
// categoría; a cada movimiento le asigna limit − acumulado hasta ese punto. `txs` viene más-nuevo
// primero (orden del repo), así que se recorre en reversa.
function historicalRemaining(txs: Transaction[], limitOf: (categoryId: string) => Money | null): Map<string, number> {
  const acc = new Map<string, Money>();
  const out = new Map<string, number>();
  for (let i = txs.length - 1; i >= 0; i--) {
    const t = txs[i];
    if (t.direction !== "debit" || !t.categoryId) continue;
    const limit = limitOf(t.categoryId);
    if (!limit || t.amount.currency !== limit.currency) continue;
    const spent = (acc.get(t.categoryId) ?? Money.zero(limit.currency)).add(t.amount);
    acc.set(t.categoryId, spent);
    out.set(t.id, limit.subtract(spent).toMajor());
  }
  return out;
}

async function categoriesOfMonth(
  deps: { budgets: BudgetRepository },
  userId: string,
  year: number,
  month: number,
): Promise<{ budgetId: string | null; categories: Category[] }> {
  const budget = await deps.budgets.findByUserMonth(userId, year, month);
  if (!budget) return { budgetId: null, categories: [] };
  return { budgetId: budget.id, categories: await deps.budgets.listCategories(budget.id) };
}

export async function getMonthlySummary(
  deps: { accounts: AccountRepository; budgets: BudgetRepository; transactions: TransactionRepository },
  userId: string,
  year: number,
  month: number,
): Promise<MonthlySummaryDTO> {
  const accounts = await deps.accounts.listByUser(userId);
  const txs = await deps.transactions.listByUserPeriod(userId, year, month);
  const { categories } = await categoriesOfMonth(deps, userId, year, month);

  const clp = (list: Transaction[], dir: string) =>
    list
      .filter((t) => t.direction === dir && t.amount.currency === CLP)
      .reduce((s, t) => s.add(t.amount), Money.zero(CLP));

  return {
    activeCash: computeActiveCash(accounts, CLP).toMajor(),
    netPosition: computeNetPosition(accounts, CLP).toMajor(),
    overdraftDebt: computeOverdraftDebt(accounts, CLP).toMajor(),
    creditCardDebts: creditCardDebts(accounts).map((d) => ({ accountId: d.account.id, name: d.account.name, debt: d.debt.toMajor() })),
    income: clp(txs, "credit").toMajor(),
    expense: clp(txs, "debit").toMajor(),
    totalBudget: categories.reduce((s, c) => s.add(c.limit), Money.zero(CLP)).toMajor(),
  };
}

export async function listAccounts(
  deps: { accounts: AccountRepository; banks: BankRepository },
  userId: string,
): Promise<AccountDTO[]> {
  const [accounts, banks] = await Promise.all([deps.accounts.listByUser(userId), deps.banks.listByUser(userId)]);
  const bankName = new Map(banks.map((b) => [b.id, b.name]));
  return accounts.map(
    (a: Account): AccountDTO => ({
      id: a.id,
      bankId: a.bankId,
      bankName: bankName.get(a.bankId) ?? "",
      name: a.name,
      accountType: a.accountType,
      currency: a.currency,
      balance: a.balance.toMajor(),
      color: a.color,
    }),
  );
}

export async function listTransactions(
  deps: { budgets: BudgetRepository; transactions: TransactionRepository },
  userId: string,
  year: number,
  month: number,
): Promise<TransactionDTO[]> {
  const txs = await deps.transactions.listByUserPeriod(userId, year, month);
  const { categories } = await categoriesOfMonth(deps, userId, year, month);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const remaining = historicalRemaining(txs, (id) => byId.get(id)?.limit ?? null);
  return txs.map((t) => txToDTO(t, t.categoryId ? byId.get(t.categoryId) : undefined, remaining.get(t.id) ?? null));
}

export async function getBudgetView(
  deps: { budgets: BudgetRepository; transactions: TransactionRepository },
  userId: string,
  year: number,
  month: number,
): Promise<BudgetViewDTO> {
  const { budgetId, categories } = await categoriesOfMonth(deps, userId, year, month);
  const txs = await deps.transactions.listByUserPeriod(userId, year, month);
  const rows = categories.map((c): CategoryDTO => {
    const { used, available } = computeCategoryUsage(c, txs, year, month);
    return {
      id: c.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      limit: c.limit.toMajor(),
      used: used.toMajor(),
      available: available.toMajor(),
      status: categoryStatus(used, c.limit),
    };
  });
  return { budgetId, categories: rows };
}

export async function getCategoryDetail(
  deps: {
    categories: CategoryRepository;
    budgets: BudgetRepository;
    transactions: TransactionRepository;
  },
  userId: string,
  categoryId: string,
  year: number,
  month: number,
): Promise<CategoryDTO & { transactions: TransactionDTO[] }> {
  const category = await deps.categories.findById(categoryId);
  if (!category) throw new CategoryNotFoundError(categoryId);
  const budget = await deps.budgets.findById(category.budgetId);
  if (!budget || budget.userId !== userId) throw new NotOwnerError();

  const txs = await deps.transactions.listByCategoryPeriod(categoryId, year, month);
  const { used, available } = computeCategoryUsage(category, txs, year, month);
  const remaining = historicalRemaining(txs, () => category.limit);
  return {
    id: category.id,
    name: category.name,
    icon: category.icon,
    color: category.color,
    limit: category.limit.toMajor(),
    used: used.toMajor(),
    available: available.toMajor(),
    status: categoryStatus(used, category.limit),
    transactions: txs.map((t) => txToDTO(t, category, remaining.get(t.id) ?? null)),
  };
}
