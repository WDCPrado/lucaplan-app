import {
  type CategoryRepository,
  type Category,
  type CategoryLimit,
  CategoryNotFoundError,
  NotOwnerError,
} from "../../domain/finance/finance.domain.ts";
import { Money } from "../../domain/finance/money.ts";

const CLP = "CLP" as const;

// Crea o edita una categoría GLOBAL del usuario (nombre, icono, color). El límite NO va aquí.
export async function upsertCategory(
  deps: { categories: CategoryRepository },
  userId: string,
  input: { id?: string; name: string; icon: string | null; color: string | null },
): Promise<Category> {
  if (input.id) {
    const existing = await deps.categories.findById(input.id);
    if (!existing) throw new CategoryNotFoundError(input.id);
    if (existing.userId !== userId) throw new NotOwnerError();
  }
  return deps.categories.upsert({ id: input.id, userId, name: input.name, icon: input.icon, color: input.color });
}

// Fija el límite de una categoría para un mes concreto (upsert por categoría+año+mes). Ownership.
export async function setCategoryLimit(
  deps: { categories: CategoryRepository },
  userId: string,
  input: { categoryId: string; year: number; month: number; limit: number },
): Promise<CategoryLimit> {
  const category = await deps.categories.findById(input.categoryId);
  if (!category) throw new CategoryNotFoundError(input.categoryId);
  if (category.userId !== userId) throw new NotOwnerError();
  return deps.categories.setLimit({
    categoryId: input.categoryId,
    year: input.year,
    month: input.month,
    limit: Money.of(input.limit, CLP),
  });
}
