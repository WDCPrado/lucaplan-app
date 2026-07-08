import {
  type BudgetRepository,
  type Budget,
  type Category,
  BudgetNotFoundError,
  NotOwnerError,
} from "../../domain/finance/finance.domain.ts";
import { Money } from "../../domain/finance/money.ts";

const CLP = "CLP" as const;

// Crea o edita el presupuesto de un mes. En edición valida ownership.
export async function upsertBudget(
  deps: { budgets: BudgetRepository },
  userId: string,
  input: { id?: string; name: string; year: number; month: number },
): Promise<Budget> {
  if (input.id) {
    const existing = await deps.budgets.findById(input.id);
    if (!existing) throw new BudgetNotFoundError(input.id);
    if (existing.userId !== userId) throw new NotOwnerError();
  }
  return deps.budgets.upsertBudget({ ...input, userId });
}

// Crea o edita una categoría dentro de un presupuesto del usuario. El límite se guarda en CLP (base).
export async function upsertCategory(
  deps: { budgets: BudgetRepository },
  userId: string,
  input: { id?: string; budgetId: string; name: string; limit: number; icon: string | null; color: string | null },
): Promise<Category> {
  const budget = await deps.budgets.findById(input.budgetId);
  if (!budget) throw new BudgetNotFoundError(input.budgetId);
  if (budget.userId !== userId) throw new NotOwnerError();
  return deps.budgets.upsertCategory({
    id: input.id,
    budgetId: input.budgetId,
    name: input.name,
    limit: Money.of(input.limit, CLP),
    icon: input.icon,
    color: input.color,
  });
}
