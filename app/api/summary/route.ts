import {
  withUser,
  financeDeps,
  periodOf,
} from "@/arch/v1/presentation/finance/finance-http"
import { getMonthlySummary } from "@/arch/v1/application/finance-use-cases/finance-read"

export async function GET(req: Request) {
  const { year, month } = await periodOf(req)
  return withUser(req, (userId) =>
    getMonthlySummary(financeDeps, userId, year, month)
  )
}
