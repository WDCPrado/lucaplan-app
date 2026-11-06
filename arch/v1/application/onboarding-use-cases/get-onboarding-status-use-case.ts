// Estado del onboarding: si la persona ya lo terminó (u omitió) y qué ofrece el servidor.
import type { OnboardingStatus } from "../../../../lib/onboarding-schemas.ts"
import {
  OnboardingCompletedError,
  type OnboardingRepository,
} from "../../domain/onboarding/onboarding.domain.ts"
import type { IntegrationDeps } from "../../domain/integrations/integrations.domain.ts"
import { resolveIntegration } from "../integration-use-cases/resolve-integration-use-case.ts"

export type OnboardingDeps = {
  onboarding: OnboardingRepository
  integrations: IntegrationDeps
}

export async function getOnboardingStatus(
  deps: OnboardingDeps,
  userId: string
): Promise<OnboardingStatus> {
  const has = async (key: Parameters<typeof resolveIntegration>[1]) =>
    (await resolveIntegration(deps.integrations, key)) !== null
  return {
    completed: (await deps.onboarding.completedAt(userId)) !== null,
    aiAvailable: await has("OPENAI_API_KEY"),
    outlookAvailable: (await has("OUTLOOK_CLIENT_ID")) && (await has("OUTLOOK_CLIENT_SECRET")),
  }
}

// Con el onboarding terminado no se propone ni se reemplaza el set de categorías: 409. `onboarding` lo pasa siempre el wiring
// (onboarding-deps.ts); sin él (y sin `userId`) no se revisa.
export async function assertOnboardingOpen(
  deps: { onboarding?: Pick<OnboardingRepository, "completedAt"> },
  userId?: string
): Promise<void> {
  if (deps.onboarding && userId && (await deps.onboarding.completedAt(userId)) !== null)
    throw new OnboardingCompletedError()
}
