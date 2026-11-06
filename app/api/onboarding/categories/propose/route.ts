import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { proposeDeps } from "@/arch/v1/infrastructure/database/prisma/onboarding-deps"
import { proposeCategoriesInput } from "@/lib/onboarding-schemas"
import { createRateWindow } from "@/arch/shared/rate-window"
import { proposeCategories } from "@/arch/v1/application/onboarding-use-cases/propose-categories-use-case"

// 5 propuestas por hora por usuario (en memoria del proceso, ver rate-window.ts).
const proposals = createRateWindow(5, 60 * 60 * 1000)

// Propone categorías con IA sobre el set precreado. No escribe.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  let limited = false
  const res = await withUser(req, async (userId) => {
    const input = proposeCategoriesInput.parse(body) // una entrada inválida no gasta cupo
    if (!proposals.take(userId)) {
      limited = true
      return { error: "Ya pediste varias propuestas. Intenta de nuevo en una hora." }
    }
    return proposeCategories(proposeDeps(), input, userId)
  })
  return limited ? new Response(res.body, { status: 429, headers: res.headers }) : res
}
