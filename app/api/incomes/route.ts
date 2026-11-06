import { incomeSchema } from "@/lib/finance-form-schemas"
import {
  withUser,
  financeForRequest,
  periodOf,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  createIncome,
  listIncomesForMonth,
  listAvailableIncomeSources,
} from "@/arch/v1/application/finance-use-cases/income-use-cases"
import { followIncome } from "@/arch/v1/application/finance-use-cases/follow-income"

// Fuentes de ingreso del usuario, con la marca de si su ingreso del mes ya fue generado.
export async function GET(req: Request) {
  return withUser(req, async (userId) => {
      const scopedDeps = await financeForRequest(req)
    if (new URL(req.url).searchParams.get("available") === "true")
      return listAvailableIncomeSources(scopedDeps, userId)
    const { year, month } = await periodOf(req, scopedDeps)
    return listIncomesForMonth(scopedDeps, userId, year, month)
  })
}

// Crea una fuente de ingreso; si el tope del período en curso estaba igualado al ingreso (o sin
// definir), lo sigue. Devuelve la fuente y si el tope cambió (para el aviso).
export async function POST(req: Request) {
  const body = await req.json()

  return withUser(
    req,
    async (userId) => {
      const scopedDeps = await financeForRequest(req)
      const parsed = incomeSchema.parse({
        sourceId: body.sourceId,
        accountId: String(body.accountId),
        categoryId: String(body.categoryId),
        name: String(body.name ?? ""),
        amount: Number(body.amount),
        dayOfMonth: Number(body.dayOfMonth),
      })
      const { year, month } = await periodOf(req, scopedDeps)
      const { result: income, seed } = await followIncome(scopedDeps, userId, () =>
        createIncome(scopedDeps, userId, { ...parsed, year, month })
      )
      return { income, seed }
    },
    201
  )
}
