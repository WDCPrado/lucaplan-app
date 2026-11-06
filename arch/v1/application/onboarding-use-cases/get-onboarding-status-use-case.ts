// Estado del onboarding: si la persona ya lo terminó (u omitió) y qué ofrece el servidor.
import type { OnboardingStatus } from "../../../../lib/onboarding-schemas.ts"
import type { OnboardingRepository } from "../../domain/onboarding/onboarding.domain.ts"

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
