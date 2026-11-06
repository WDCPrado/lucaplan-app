import { monthlyBudgetSchema } from "@/lib/finance-form-schemas"
import {
  withUser,
  financeForRequest,
  periodOf,
} from "@/arch/v1/presentation/finance/finance-http"
import { getBudgetView } from "@/arch/v1/application/finance-use-cases/finance-read"
import { setMonthlyBudgetFollowing } from "@/arch/v1/application/finance-use-cases/follow-income"

// Vista del mes: categorías (globales) con su límite efectivo, uso, disponible y estado, más el
// límite global del presupuesto (carry), lo asignado y el restante por presupuestar.
export async function GET(req: Request) {
  return withUser(req, async (userId) => {
      const scopedDeps = await financeForRequest(req)
    const { year, month } = await periodOf(req, scopedDeps)
    return getBudgetView(scopedDeps, userId, year, month)
  })
}

// Define el límite global del presupuesto de un mes (upsert por usuario+año+mes). El use-case
// valida (entero ≥ 0, mes 1–12, año en rango) y responde 422 si el input es inválido.
// `followIncome: true` lo manda «Igualar al ingreso»: el tope seguirá solo al total del plan.
// En el período en curso el servidor lo deja en el total real. Sin él, el tope queda fijado a mano.
export async function POST(req: Request) {
  const body = await req.json()
  return withUser(req, async (userId) => {
      const scopedDeps = await financeForRequest(req)
    const parsed = monthlyBudgetSchema.parse({
      year: Number(body.year),
      month: Number(body.month),
      globalLimit: Number(body.globalLimit),
    })
    return setMonthlyBudgetFollowing(scopedDeps, userId, { ...parsed, followIncome: body.followIncome === true })
  })
}
