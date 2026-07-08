import {
  type BudgetRepository,
  type TransactionRepository,
  BudgetNotFoundError,
} from "../../domain/finance/finance.domain.ts";
import { summarizeBudget, type BudgetSummary } from "./budget-formulas.ts";

// Carga el presupuesto, sus categorías y los movimientos del mes vía ports, y devuelve
// el resumen calculado. Sin adapter real todavía: los repos se inyectan (tests con fakes).
export async function getBudgetSummary(
  deps: { budgets: BudgetRepository; transactions: TransactionRepository },
  budgetId: string,
): Promise<BudgetSummary> {
  const budget = await deps.budgets.findById(budgetId);
  if (!budget) throw new BudgetNotFoundError(budgetId);
  const categories = await deps.budgets.listCategories(budgetId);
  const transactions = await deps.transactions.listByUserPeriod(budget.userId, budget.year, budget.month);
  return summarizeBudget(budget, categories, transactions);
}
