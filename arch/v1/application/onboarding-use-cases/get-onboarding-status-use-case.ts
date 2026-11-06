// Estado del onboarding: si la persona ya lo terminó (u omitió) y qué ofrece el servidor.
import type { OnboardingStatus } from "../../../../lib/onboarding-schemas.ts"
import {
  OnboardingCompletedError,
  type OnboardingRepository,
} from "../../domain/onboarding/onboarding.domain.ts"

export type OnboardingDeps = {
  onboarding: OnboardingRepository
  env: Record<string, string | undefined>
}

export async function getOnboardingStatus(
  deps: OnboardingDeps,
  userId: string
): Promise<OnboardingStatus> {
  return {
    completed: (await deps.onboarding.completedAt(userId)) !== null,
    aiAvailable: !!deps.env.OPENAI_API_KEY,
    outlookAvailable: !!(deps.env.OUTLOOK_CLIENT_ID && deps.env.OUTLOOK_CLIENT_SECRET),
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
