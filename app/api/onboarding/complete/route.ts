import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { onboardingDeps } from "@/arch/v1/infrastructure/database/prisma/onboarding-deps"
import { completeOnboarding } from "@/arch/v1/application/onboarding-use-cases/complete-onboarding-use-case"

// Terminar u omitir el onboarding. Idempotente.
export async function POST(req: Request) {
  return withUser(req, (userId) => completeOnboarding(onboardingDeps, userId))
}
