import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { proposeDeps } from "@/arch/v1/infrastructure/database/prisma/onboarding-deps"
import { proposeCategoriesInput } from "@/lib/onboarding-schemas"
import { proposeCategories } from "@/arch/v1/application/onboarding-use-cases/propose-categories-use-case"

const LIMIT = 5
const WINDOW_MS = 60 * 60 * 1000
// ponytail: límite en memoria por proceso (5 por hora por usuario); con varias réplicas el techo
// real es 5 × réplicas, y se pierde al reiniciar. Si hace falta, moverlo a la base o a Redis.
const recent = new Map<string, number[]>()

function allow(userId: string): boolean {
  const now = Date.now()
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS)
  if (hits.length >= LIMIT) {
    recent.set(userId, hits)
    return false
  }
  hits.push(now)
  recent.set(userId, hits)
  return true
}

// Propone categorías con IA sobre el set precreado. No escribe.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  let limited = false
  const res = await withUser(req, async (userId) => {
    const input = proposeCategoriesInput.parse(body) // una entrada inválida no gasta cupo
    if (!allow(userId)) {
      limited = true
      return { error: "Ya pediste varias propuestas. Intenta de nuevo en una hora." }
    }
    return proposeCategories(proposeDeps(), input)
  })
  return limited ? new Response(res.body, { status: 429, headers: res.headers }) : res
}
