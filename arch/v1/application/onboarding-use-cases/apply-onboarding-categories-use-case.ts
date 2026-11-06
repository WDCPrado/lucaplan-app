// Guarda el set de categorías del onboarding. Upsert por nombre (sin importar mayúsculas ni
// espacios): una categoría que ya existe conserva su id, así sus movimientos la siguen apuntando.
// Las del usuario que no vienen en el set se eliminan solo si nada las usa. Valida todo antes de
// escribir. La transacción la pone quien compone las deps (onboarding-deps.ts).
import { applyCategoriesInput, type OnboardingCategory } from "../../../../lib/onboarding-schemas.ts"
import {
  AmbiguousCategoryNameError,
  CATEGORY_COLOR_VALUES,
  CATEGORY_ICON_NAMES,
  type CategoryUsage,
  type OnboardingRepository,
} from "../../domain/onboarding/onboarding.domain.ts"
import type { Category, CategoryRepository } from "../../domain/finance/finance.domain.ts"
import { assertOnboardingOpen } from "./get-onboarding-status-use-case.ts"

const catalogInput = applyCategoriesInput.superRefine(({ categories }, ctx) => {
  categories.forEach((c, i) => {
    if (!CATEGORY_ICON_NAMES.includes(c.icon))
      ctx.addIssue({ code: "custom", path: ["categories", i, "icon"], message: "Icono fuera del catálogo" })
    if (!CATEGORY_COLOR_VALUES.includes(c.color))
      ctx.addIssue({ code: "custom", path: ["categories", i, "color"], message: "Color fuera de la paleta" })
  })
})

const key = (name: string) => name.trim().toLowerCase()

// La categoría existente que corresponde a un nombre enviado. Si hay varias con la misma clave
// («Comida» y «comida»), manda la de nombre exacto; si ninguna lo tiene, no se adivina.
function matchExisting(groups: Map<string, Category[]>, name: string): Category | undefined {
  const same = groups.get(key(name)) ?? []
  if (same.length <= 1) return same[0]
  const exact = same.find((c) => c.name.trim() === name)
  if (!exact) throw new AmbiguousCategoryNameError(name)
  return exact
}

export async function applyOnboardingCategories(
  deps: {
    categories: Pick<CategoryRepository, "listByUser" | "upsert" | "delete">
    usage: CategoryUsage
    onboarding?: Pick<OnboardingRepository, "completedAt">
  },
  userId: string,
  input: unknown
): Promise<{ categories: OnboardingCategory[] }> {
  const { categories } = catalogInput.parse(input)
  await assertOnboardingOpen(deps, userId)
  const [existing, used] = await Promise.all([
    deps.categories.listByUser(userId),
    deps.usage.usedCategoryIds(userId),
  ])
  const groups = new Map<string, Category[]>()
  for (const c of existing) groups.set(key(c.name), [...(groups.get(key(c.name)) ?? []), c])
  // Todo lo que puede fallar se resuelve antes de la primera escritura.
  const targets = categories.map((c) => ({ c, id: matchExisting(groups, c.name)?.id }))
  const wanted = new Set(categories.map((c) => key(c.name)))
  for (const c of existing)
    if (!wanted.has(key(c.name)) && !used.has(c.id)) await deps.categories.delete(c.id)
  for (const { c, id } of targets)
    await deps.categories.upsert({
      id,
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
