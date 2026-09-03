import {
  type CategoryRepository,
  type Category,
  type CategoryLimit,
  type CategoryType,
  CategoryInUseError,
  CategoryNotFoundError,
  NotOwnerError,
} from "../../domain/finance/finance.domain.ts"
import type { RecurringTemplateRepository } from "../../domain/finance/recurring.domain.ts"
import type { InstallmentPlanRepository } from "../../domain/finance/installment.domain.ts"
import { Money } from "../../domain/finance/money.ts"

const CLP = "CLP" as const

// Crea o edita una categoría GLOBAL del usuario (nombre, icono, color). El límite NO va aquí.
export async function upsertCategory(
  deps: { categories: CategoryRepository },
  userId: string,
  input: {
    id?: string
    name: string
    type: CategoryType
    icon: string | null
    color: string | null
    description: string | null
    paceEnabled?: boolean // omitido = se conserva el actual; al crear, el default de la BD
  }
): Promise<Category> {
  if (input.id) {
    const existing = await deps.categories.findById(input.id)
    if (!existing) throw new CategoryNotFoundError(input.id)
    if (existing.userId !== userId) throw new NotOwnerError()
  }
  return deps.categories.upsert({
    id: input.id,
    userId,
    name: input.name,
    type: input.type,
    icon: input.icon,
    color: input.color,
    description: input.description,
    paceEnabled: input.paceEnabled,
  })
}

// Elimina la categoría: los movimientos quedan sin categoría (FK SetNull) y los ingresos
// asignados se eliminan en cascada. Bloqueado si recurrentes o planes de cuotas la usan —
// esas entidades exigen categoría y el cascade las borraría en silencio.
export async function deleteCategory(
  deps: {
    categories: CategoryRepository
    recurring: RecurringTemplateRepository
    installments: InstallmentPlanRepository
  },
  userId: string,
  categoryId: string
): Promise<void> {
  const category = await deps.categories.findById(categoryId)
  if (!category) throw new CategoryNotFoundError(categoryId)
  if (category.userId !== userId) throw new NotOwnerError()
  const [recurring, plans] = await Promise.all([
    deps.recurring.listByUser(userId),
    deps.installments.listByUser(userId),
  ])
  const inRecurring = recurring.filter(
    (r) => r.categoryId === categoryId
  ).length
  const inPlans = plans.filter((p) => p.categoryId === categoryId).length
  if (inRecurring > 0 || inPlans > 0)
    throw new CategoryInUseError(inRecurring, inPlans)
  await deps.categories.delete(categoryId)
}

// Fija el límite de una categoría para un mes concreto (upsert por categoría+año+mes). Ownership.
export async function setCategoryLimit(
  deps: { categories: CategoryRepository },
  userId: string,
  input: { categoryId: string; year: number; month: number; limit: number }
): Promise<CategoryLimit> {
  const category = await deps.categories.findById(input.categoryId)
  if (!category) throw new CategoryNotFoundError(input.categoryId)
  if (category.userId !== userId) throw new NotOwnerError()
  return deps.categories.setLimit({
    categoryId: input.categoryId,
    year: input.year,
    month: input.month,
    limit: Money.of(input.limit, CLP),
  })
}
