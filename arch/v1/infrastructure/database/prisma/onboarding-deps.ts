// Wiring del onboarding: adapters listos para inyectar en los use-cases (mismo criterio que
// push-deps). Lo usan las rutas de app/api/onboarding/** y el dashboard (server component).
import {
  onboardingRepository,
  onboardingRepositoryIn,
  categoriesIn,
  categoryUsageIn,
} from "./onboarding.infrastructure.ts"
import { prisma } from "./client.ts"
import { openaiConfigured } from "../../http/ai/openai-config.ts"
import { openaiCategoryProposer } from "../../http/ai/openai-category-proposer.provider.ts"
import { getOnboardingStatus } from "../../../application/onboarding-use-cases/get-onboarding-status-use-case.ts"
import { applyOnboardingCategories } from "../../../application/onboarding-use-cases/apply-onboarding-categories-use-case.ts"

export const onboardingDeps = { onboarding: onboardingRepository, env: process.env }

// Sin OPENAI_API_KEY no hay proposer: la propuesta es el set precreado.
export const proposeDeps = () => ({
  proposer: openaiConfigured() ? openaiCategoryProposer : null,
  onboarding: onboardingRepository,
})

/** Estado del onboarding de un usuario, listo para llamar desde un server component. */
export const getOnboardingStatusFor = (userId: string) =>
  getOnboardingStatus(onboardingDeps, userId)

/**
 * Guarda el set de categorías en una sola transacción serializable, con la marca de terminado
 * leída adentro. Reintenta solo los conflictos de serialización (P2034): un nombre único repetido
 * (P2002) no se arregla reintentando y sube como error.
 */
export async function applyOnboardingCategoriesFor(userId: string, input: unknown) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        (db) =>
          applyOnboardingCategories(
            { categories: categoriesIn(db), usage: categoryUsageIn(db), onboarding: onboardingRepositoryIn(db) },
            userId,
            input
          ),
        { isolationLevel: "Serializable" }
      )
    } catch (error) {
      if (attempt >= 4 || (error as { code?: string }).code !== "P2034") throw error
    }
  }
}
