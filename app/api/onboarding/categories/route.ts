import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { applyOnboardingCategoriesFor } from "@/arch/v1/infrastructure/database/prisma/onboarding-deps"

// Guarda el set de categorías del onboarding (upsert por nombre, en una transacción).
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null)
  return withUser(req, (userId) => applyOnboardingCategoriesFor(userId, body))
}
