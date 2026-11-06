// Guarda el set de categorías del onboarding. Upsert por nombre (sin importar mayúsculas ni
// espacios): una categoría que ya existe conserva su id, así sus movimientos la siguen apuntando.
// Las del usuario que no vienen en el set se eliminan solo si nada las usa. Valida todo antes de
// escribir. La transacción la pone quien compone las deps (onboarding-deps.ts).
import { applyCategoriesInput, type OnboardingCategory } from "../../../../lib/onboarding-schemas.ts"
import {
  CATEGORY_COLOR_VALUES,
  CATEGORY_ICON_NAMES,
  type CategoryUsage,
} from "../../domain/onboarding/onboarding.domain.ts"
import type { CategoryRepository } from "../../domain/finance/finance.domain.ts"

const catalogInput = applyCategoriesInput.superRefine(({ categories }, ctx) => {
  categories.forEach((c, i) => {
    if (!CATEGORY_ICON_NAMES.includes(c.icon))
      ctx.addIssue({ code: "custom", path: ["categories", i, "icon"], message: "Icono fuera del catálogo" })
    if (!CATEGORY_COLOR_VALUES.includes(c.color))
      ctx.addIssue({ code: "custom", path: ["categories", i, "color"], message: "Color fuera de la paleta" })
  })
})

const key = (name: string) => name.trim().toLowerCase()

export async function applyOnboardingCategories(
  deps: {
    categories: Pick<CategoryRepository, "listByUser" | "upsert" | "delete">
    usage: CategoryUsage
  },
  userId: string,
  input: unknown
): Promise<{ categories: OnboardingCategory[] }> {
  const { categories } = catalogInput.parse(input)
  const [existing, used] = await Promise.all([
    deps.categories.listByUser(userId),
    deps.usage.usedCategoryIds(userId),
  ])
  const byKey = new Map(existing.map((c) => [key(c.name), c]))
  const wanted = new Set(categories.map((c) => key(c.name)))
  for (const c of existing)
    if (!wanted.has(key(c.name)) && !used.has(c.id)) await deps.categories.delete(c.id)
  for (const c of categories)
    await deps.categories.upsert({
      id: byKey.get(key(c.name))?.id,
      userId,
      name: c.name,
      type: c.type,
      icon: c.icon,
      color: c.color,
      description: c.description,
    })
  const saved = await deps.categories.listByUser(userId)
  return {
    categories: saved.map((c) => ({
      name: c.name,
      type: c.type,
      icon: c.icon ?? "",
      color: c.color ?? "",
      description: c.description,
    })),
  }
}
