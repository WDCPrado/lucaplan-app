// Use-cases de lectura financiera. DTOs con montos en unidad mayor (number). Ownership por userId.
// Categorías GLOBALES del usuario; el límite es por mes con carry-forward (ver effectiveLimit).
import type {
  Account,
  AccountRepository,
  BankRepository,
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
  effectiveLimit,
} from "./budget-formulas.ts";

const CLP = "CLP" as const;

type ReadDeps = {
  accounts: AccountRepository;
  banks: BankRepository;
  categories: CategoryRepository;
  transactions: TransactionRepository;
};

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
  cardLast4: string | null;
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

export type BudgetViewDTO = { categories: CategoryDTO[] };

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

// Categorías del usuario con su límite EFECTIVO para (year, month) — carry-forward incluido.
async function categoriesWithLimit(
  deps: { categories: CategoryRepository },
  userId: string,
  year: number,
  month: number,
): Promise<{ category: Category; limit: Money }[]> {
  const [cats, limits] = await Promise.all([deps.categories.listByUser(userId), deps.categories.listLimitsByUser(userId)]);
  return cats.map((category) => ({ category, limit: effectiveLimit(limits, category.id, year, month) }));
}

export async function getMonthlySummary(deps: ReadDeps, userId: string, year: number, month: number): Promise<MonthlySummaryDTO> {
  const accounts = await deps.accounts.listByUser(userId);
  const txs = await deps.transactions.listByUserPeriod(userId, year, month);
  const withLimit = await categoriesWithLimit(deps, userId, year, month);

  const sumClp = (dir: string) =>
    txs.filter((t) => t.direction === dir && t.amount.currency === CLP).reduce((s, t) => s.add(t.amount), Money.zero(CLP));

  return {
    activeCash: computeActiveCash(accounts, CLP).toMajor(),
    netPosition: computeNetPosition(accounts, CLP).toMajor(),
    overdraftDebt: computeOverdraftDebt(accounts, CLP).toMajor(),
    creditCardDebts: creditCardDebts(accounts).map((d) => ({ accountId: d.account.id, name: d.account.name, debt: d.debt.toMajor() })),
    income: sumClp("credit").toMajor(),
    expense: sumClp("debit").toMajor(),
    totalBudget: withLimit.reduce((s, x) => s.add(x.limit), Money.zero(CLP)).toMajor(),
  };
}

export async function listAccounts(deps: { accounts: AccountRepository; banks: BankRepository }, userId: string): Promise<AccountDTO[]> {
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
      cardLast4: a.cardLast4,
    }),
  );
}

export async function listTransactions(deps: ReadDeps, userId: string, year: number, month: number): Promise<TransactionDTO[]> {
  const txs = await deps.transactions.listByUserPeriod(userId, year, month);
  const withLimit = await categoriesWithLimit(deps, userId, year, month);
  const catById = new Map(withLimit.map((x) => [x.category.id, x.category]));
  const limitById = new Map(withLimit.map((x) => [x.category.id, x.limit]));
  const remaining = historicalRemaining(txs, (id) => limitById.get(id) ?? null);
  return txs.map((t) => txToDTO(t, t.categoryId ? catById.get(t.categoryId) : undefined, remaining.get(t.id) ?? null));
}

export async function getBudgetView(deps: ReadDeps, userId: string, year: number, month: number): Promise<BudgetViewDTO> {
  const withLimit = await categoriesWithLimit(deps, userId, year, month);
  const txs = await deps.transactions.listByUserPeriod(userId, year, month);
  const categories = withLimit.map(({ category, limit }): CategoryDTO => {
    const { used, available } = computeCategoryUsage(category.id, limit, txs, year, month);
    return {
      id: category.id,
      name: category.name,
      icon: category.icon,
      color: category.color,
      limit: limit.toMajor(),
      used: used.toMajor(),
      available: available.toMajor(),
      status: categoryStatus(used, limit),
    };
  });
  return { categories };
}

export async function getCategoryDetail(
  deps: ReadDeps,
  userId: string,
  categoryId: string,
  year: number,
  month: number,
): Promise<CategoryDTO & { transactions: TransactionDTO[] }> {
  const category = await deps.categories.findById(categoryId);
  if (!category) throw new CategoryNotFoundError(categoryId);
  if (category.userId !== userId) throw new NotOwnerError();

  const limits = await deps.categories.listLimitsByUser(userId);
  const limit = effectiveLimit(limits, categoryId, year, month);
  const txs = await deps.transactions.listByCategoryPeriod(categoryId, year, month);
  const { used, available } = computeCategoryUsage(categoryId, limit, txs, year, month);
  const remaining = historicalRemaining(txs, () => limit);
  return {
    id: category.id,
    name: category.name,
    icon: category.icon,
    color: category.color,
    limit: limit.toMajor(),
    used: used.toMajor(),
    available: available.toMajor(),
    status: categoryStatus(used, limit),
    transactions: txs.map((t) => txToDTO(t, category, remaining.get(t.id) ?? null)),
  };
}
