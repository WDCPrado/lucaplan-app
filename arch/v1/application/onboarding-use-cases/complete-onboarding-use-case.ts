// Terminar u omitir el onboarding. Idempotente: la primera fecha manda.
import type { OnboardingStatus } from "../../../../lib/onboarding-schemas.ts"
import { getOnboardingStatus, type OnboardingDeps } from "./get-onboarding-status-use-case.ts"

export async function completeOnboarding(
  deps: OnboardingDeps,
  userId: string
): Promise<OnboardingStatus> {
  if ((await deps.onboarding.completedAt(userId)) === null)
    await deps.onboarding.markCompleted(userId, new Date())
  return getOnboardingStatus(deps, userId)
}
