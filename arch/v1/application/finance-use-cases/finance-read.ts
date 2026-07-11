// Use-cases de lectura financiera. DTOs con montos en unidad mayor (number). Ownership por userId.
// Categorías GLOBALES del usuario; el límite es por mes con carry-forward (ver effectiveLimit).
import type {
  Account,
  AccountRepository,
  BankRepository,
  Category,
  CategoryRepository,
  MonthlyBudgetRepository,
  Transaction,
  TransactionRepository,
  TransactionSearchFilters,
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
  effectiveGlobalLimit,
  remainingToAllocate,
} from "./budget-formulas.ts";

const CLP = "CLP" as const;

type ReadDeps = {
  accounts: AccountRepository;
  banks: BankRepository;
  categories: CategoryRepository;
  transactions: TransactionRepository;
  monthlyBudgets: MonthlyBudgetRepository;
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
  provider: string; // "manual" | "fintoc"; las fintoc son de solo lectura (badge "conectado")
  lastSyncedAt: string | null; // ISO; última sync del banco conectado (null en cuentas manuales)
};

export type TransactionDTO = {
  id: string;
  accountId: string;
  currency: string;
  editable: boolean; // true solo si su cuenta es manual (las fintoc son de solo lectura)
  description: string;
  amount: number;
  direction: string;
  date: string;
  status: string; // confirmed | pending | reversed | duplicated (solo confirmed cuenta)
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  remaining: number | null; // histórico: lo que quedaba de la categoría justo tras este movimiento
  categoryLimit: number | null; // límite efectivo del mes de su categoría (para el arco); null si no aplica
};

export type CategoryDTO = {
  id: string;
  name: string;
  type: string; // "income" (ingreso) | "expense" (gasto)
  icon: string | null;
  color: string | null;
  description: string | null; // contexto para la IA; se edita en el modal
  limit: number;
  used: number;
  available: number;
  status: string;
};

export type BudgetViewDTO = {
  categories: CategoryDTO[];
  globalLimit: number | null; // límite global efectivo del mes (carry); null = no definido
  allocated: number; // Σ límites efectivos de las categorías de GASTO
  remainingToAllocate: number | null; // globalLimit − allocated; null sin límite global
};

function txToDTO(
  t: Transaction,
  cat: Category | undefined,
  remaining: number | null,
  categoryLimit: number | null,
  editable: boolean,
): TransactionDTO {
  return {
    id: t.id,
    accountId: t.accountId,
    currency: t.amount.currency,
    editable,
    description: t.description,
    amount: t.amount.toMajor(),
    direction: t.direction,
    date: t.date.toISOString(),
    status: t.status,
    categoryId: t.categoryId,
    categoryName: cat?.name ?? null,
    categoryIcon: cat?.icon ?? null,
    categoryColor: cat?.color ?? null,
    remaining,
    categoryLimit,
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
    if (t.direction !== "debit" || !t.categoryId || t.status !== "confirmed") continue;
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
    txs
      .filter((t) => t.direction === dir && t.amount.currency === CLP && t.status === "confirmed")
      .reduce((s, t) => s.add(t.amount), Money.zero(CLP));

  return {
    activeCash: computeActiveCash(accounts, CLP).toMajor(),
    netPosition: computeNetPosition(accounts, CLP).toMajor(),
    overdraftDebt: computeOverdraftDebt(accounts, CLP).toMajor(),
    creditCardDebts: creditCardDebts(accounts).map((d) => ({ accountId: d.account.id, name: d.account.name, debt: d.debt.toMajor() })),
    income: sumClp("credit").toMajor(),
    expense: sumClp("debit").toMajor(),
    // Solo categorías de gasto: mismo criterio que `allocated` en la vista de presupuestos.
    totalBudget: withLimit
      .filter((x) => x.category.type === "expense")
      .reduce((s, x) => s.add(x.limit), Money.zero(CLP))
      .toMajor(),
  };
}

export async function listAccounts(deps: { accounts: AccountRepository; banks: BankRepository }, userId: string): Promise<AccountDTO[]> {
  const [accounts, banks] = await Promise.all([deps.accounts.listByUser(userId), deps.banks.listByUser(userId)]);
  const bankById = new Map(banks.map((b) => [b.id, b]));
  return accounts.map((a: Account): AccountDTO => {
    const bank = bankById.get(a.bankId);
    return {
      id: a.id,
      bankId: a.bankId,
      bankName: bank?.name ?? "",
      name: a.name,
      accountType: a.accountType,
      currency: a.currency,
      balance: a.balance.toMajor(),
      color: a.color,
      cardLast4: a.cardLast4,
      provider: a.provider,
      lastSyncedAt: bank?.lastSyncedAt?.toISOString() ?? null,
    };
  });
}

export async function listTransactions(deps: ReadDeps, userId: string, year: number, month: number): Promise<TransactionDTO[]> {
  const txs = await deps.transactions.listByUserPeriod(userId, year, month);
  const withLimit = await categoriesWithLimit(deps, userId, year, month);
  const accounts = await deps.accounts.listByUser(userId);
  const manual = new Set(accounts.filter((a) => a.provider === "manual").map((a) => a.id));
  const catById = new Map(withLimit.map((x) => [x.category.id, x.category]));
  const limitById = new Map(withLimit.map((x) => [x.category.id, x.limit]));
  const remaining = historicalRemaining(txs, (id) => limitById.get(id) ?? null);
  // La lista no muestra reversados ni duplicados (ruido); sí muestra confirmed y pending.
  return txs
    .filter((t) => t.status !== "reversed" && t.status !== "duplicated")
    .map((t) =>
      txToDTO(
        t,
        t.categoryId ? catById.get(t.categoryId) : undefined,
        remaining.get(t.id) ?? null,
        t.categoryId ? (limitById.get(t.categoryId)?.toMajor() ?? null) : null,
        manual.has(t.accountId),
      ),
    );
}

// Búsqueda de movimientos con filtros combinados. Devuelve TransactionDTO[] (sin "quedan" histórico,
// que es propio de la vista por periodo). editable según el origen de la cuenta.
export async function searchTransactions(deps: ReadDeps, userId: string, filters: TransactionSearchFilters): Promise<TransactionDTO[]> {
  const [txs, cats, accounts] = await Promise.all([
    deps.transactions.searchByUser(userId, filters),
    deps.categories.listByUser(userId),
    deps.accounts.listByUser(userId),
  ]);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const manual = new Set(accounts.filter((a) => a.provider === "manual").map((a) => a.id));
  return txs.map((t) => txToDTO(t, t.categoryId ? catById.get(t.categoryId) : undefined, null, null, manual.has(t.accountId)));
}

export async function getBudgetView(deps: ReadDeps, userId: string, year: number, month: number): Promise<BudgetViewDTO> {
  const [withLimit, txs, budgets] = await Promise.all([
    categoriesWithLimit(deps, userId, year, month),
    deps.transactions.listByUserPeriod(userId, year, month),
    deps.monthlyBudgets.listByUser(userId),
  ]);
  const categories = withLimit.map(({ category, limit }): CategoryDTO => {
    const { used, available } = computeCategoryUsage(category.id, limit, txs, year, month);
    return {
      id: category.id,
      name: category.name,
      type: category.type,
      icon: category.icon,
      color: category.color,
      description: category.description,
      limit: limit.toMajor(),
      used: used.toMajor(),
      available: available.toMajor(),
      status: categoryStatus(used, limit),
    };
  });
  const allocated = withLimit
    .filter((x) => x.category.type === "expense")
    .reduce((s, x) => s.add(x.limit), Money.zero(CLP));
  const globalLimit = effectiveGlobalLimit(budgets, year, month);
  const remaining = remainingToAllocate(globalLimit, allocated);
  return {
    categories,
    globalLimit: globalLimit === null ? null : globalLimit.toMajor(),
    allocated: allocated.toMajor(),
    remainingToAllocate: remaining === null ? null : remaining.toMajor(),
  };
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
  const accounts = await deps.accounts.listByUser(userId);
  const manual = new Set(accounts.filter((a) => a.provider === "manual").map((a) => a.id));
  const { used, available } = computeCategoryUsage(categoryId, limit, txs, year, month);
  const remaining = historicalRemaining(txs, () => limit);
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    icon: category.icon,
    color: category.color,
    description: category.description,
    limit: limit.toMajor(),
    used: used.toMajor(),
    available: available.toMajor(),
    status: categoryStatus(used, limit),
    transactions: txs
      .filter((t) => t.status !== "reversed" && t.status !== "duplicated")
      .map((t) => txToDTO(t, category, remaining.get(t.id) ?? null, limit.toMajor(), manual.has(t.accountId))),
  };
}
