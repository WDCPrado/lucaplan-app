import {
  withUser,
  financeDeps,
  periodOf,
} from "@/arch/v1/presentation/finance/finance-http"
import { listTransactions } from "@/arch/v1/application/finance-use-cases/finance-read"

// Solo lectura: todo movimiento real viene del banco (correo o cartola); no hay altas manuales.
export async function GET(req: Request) {
  return withUser(req, async (userId) => {
    const { year, month } = await periodOf(req)
    return listTransactions(financeDeps, userId, year, month)
  })
}
