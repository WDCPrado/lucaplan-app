import {
  withUser,
  financeDeps,
  periodOf,
} from "@/arch/v1/presentation/finance/finance-http"
import { getMonthlySummary } from "@/arch/v1/application/finance-use-cases/finance-read"

export async function GET(req: Request) {
  return withUser(req, async (userId) => {
    const { year, month } = await periodOf(req)
    return getMonthlySummary(financeDeps, userId, year, month)
  })
}
