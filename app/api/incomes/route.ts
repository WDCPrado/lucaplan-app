import {
  withUser,
  financeDeps,
  periodOf,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  createIncome,
  listIncomesForMonth,
  seedGlobalLimitFromIncomes,
} from "@/arch/v1/application/finance-use-cases/income-use-cases"

// Fuentes de ingreso del usuario, con la marca de si su ingreso del mes ya fue generado.
export async function GET(req: Request) {
  return withUser(req, async (userId) => {
    const { year, month } = await periodOf(req)
    return listIncomesForMonth(financeDeps, userId, year, month)
  })
}

// Crea una fuente de ingreso y, si el mes aún no tiene límite global, lo siembra con la suma de
// ingresos activos. Devuelve la fuente y el resultado de la siembra (para sugerir al usuario).
export async function POST(req: Request) {
  const body = await req.json()
  return withUser(
    req,
    async (userId) => {
      const { year, month } = await periodOf(req)
      const income = await createIncome(financeDeps, userId, {
        accountId: String(body.accountId),
        categoryId: String(body.categoryId),
        name: String(body.name ?? ""),
        amount: Number(body.amount),
        dayOfMonth: Number(body.dayOfMonth),
        year,
        month,
      })
      const seed = await seedGlobalLimitFromIncomes(financeDeps, userId, {
        year,
        month,
      })
      return { income, seed }
    },
    201
  )
}
