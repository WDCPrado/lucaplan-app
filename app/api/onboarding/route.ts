import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { getOnboardingStatusFor } from "@/arch/v1/infrastructure/database/prisma/onboarding-deps"

// Estado del onboarding: si ya se terminó y qué ofrece el servidor (IA, Outlook).
export async function GET(req: Request) {
  return withUser(req, (userId) => getOnboardingStatusFor(userId))
}
