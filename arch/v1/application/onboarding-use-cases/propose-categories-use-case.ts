// Propone el set de categorías de una cuenta nueva: la IA ajusta el set precreado según lo que la
// persona cuenta de su día a día. No escribe. Sin IA, o si la respuesta no calza, devuelve el set
// precreado tal cual (source "default"): el onboarding nunca se traba por la IA.
import {
  proposeCategoriesInput,
  proposeCategoriesOutput,
  type ProposeCategoriesOutput,
} from "../../../../lib/onboarding-schemas.ts"
import { assertOnboardingOpen } from "./get-onboarding-status-use-case.ts"
import { DEFAULT_CATEGORIES } from "../finance-use-cases/seed-default-categories-use-case.ts"
import {
  CATEGORY_COLOR_VALUES,
  CATEGORY_ICON_NAMES,
  type CategoryProposer,
  type OnboardingRepository,
} from "../../domain/onboarding/onboarding.domain.ts"

const MAX_CATEGORIES = 30 // el mismo tope que acepta guardar

const fallback = (): ProposeCategoriesOutput => ({
  source: "default",
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, change: "kept", reason: null })),
})

// Icono o color fuera del catálogo → el de la categoría precreada del mismo nombre, o uno fijo.
function toCatalog(raw: unknown, index: number): unknown {
  if (!raw || typeof raw !== "object") return raw
  const c = raw as Record<string, unknown>
  const base = DEFAULT_CATEGORIES.find(
    (d) => typeof c.name === "string" && d.name.toLowerCase() === c.name.trim().toLowerCase()
  )
  const icon =
    typeof c.icon === "string" && CATEGORY_ICON_NAMES.includes(c.icon)
      ? c.icon
      : (base?.icon ?? (c.type === "income" ? "Wallet" : "ShoppingBag"))
  const color =
    typeof c.color === "string" && CATEGORY_COLOR_VALUES.includes(c.color)
      ? c.color
      : (base?.color ?? CATEGORY_COLOR_VALUES[index % CATEGORY_COLOR_VALUES.length])
  return { ...c, icon, color }
}

export async function proposeCategories(
  deps: {
    proposer: CategoryProposer | null
    onboarding?: Pick<OnboardingRepository, "completedAt">
  },
  input: unknown,
  userId?: string
): Promise<ProposeCategoriesOutput> {
  const { description } = proposeCategoriesInput.parse(input)
  await assertOnboardingOpen(deps, userId)
  if (!deps.proposer) return fallback()
  let raw: unknown
  try {
    raw = await deps.proposer.propose({ description, base: DEFAULT_CATEGORIES })
  } catch {
    return fallback()
  }
  const list = (raw as { categories?: unknown } | null)?.categories
  if (!Array.isArray(list) || list.length === 0) return fallback()
  const parsed = proposeCategoriesOutput.safeParse({
    source: "ai",
    categories: list.slice(0, MAX_CATEGORIES).map(toCatalog),
  })
  if (!parsed.success) return fallback()
  // Nombres repetidos no se podrían guardar: se queda la primera.
  const seen = new Set<string>()
  parsed.data.categories = parsed.data.categories.filter((c) => {
    const key = c.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return parsed.data
}
