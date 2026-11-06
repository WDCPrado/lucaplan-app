// Wiring del onboarding: adapters listos para inyectar en los use-cases (mismo criterio que
// push-deps). Lo usan las rutas de app/api/onboarding/** y el dashboard (server component).
import { onboardingRepository, categoriesIn, categoryUsageIn } from "./onboarding.infrastructure.ts"
import { reimbursementTransaction } from "./reimbursement.infrastructure.ts"
import { openaiConfigured } from "../../http/ai/openai-config.ts"
import { openaiCategoryProposer } from "../../http/ai/openai-category-proposer.provider.ts"
import { getOnboardingStatus } from "../../../application/onboarding-use-cases/get-onboarding-status-use-case.ts"
import { applyOnboardingCategories } from "../../../application/onboarding-use-cases/apply-onboarding-categories-use-case.ts"

export const onboardingDeps = { onboarding: onboardingRepository, env: process.env }

// Sin OPENAI_API_KEY no hay proposer: la propuesta es el set precreado.
export const proposeDeps = () => ({ proposer: openaiConfigured() ? openaiCategoryProposer : null })

/** Estado del onboarding de un usuario, listo para llamar desde un server component. */
export const getOnboardingStatusFor = (userId: string) =>
  getOnboardingStatus(onboardingDeps, userId)

/** Guarda el set de categorías en una sola transacción (serializable, con reintento). */
export const applyOnboardingCategoriesFor = (userId: string, input: unknown) =>
  reimbursementTransaction((db) =>
    applyOnboardingCategories({ categories: categoriesIn(db), usage: categoryUsageIn(db) }, userId, input)
  )
