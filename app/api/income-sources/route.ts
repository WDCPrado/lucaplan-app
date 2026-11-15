import { withUser, financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import {
  createIncomeSource,
  listIncomeSources,
} from "@/arch/v1/application/finance-use-cases/income-source-use-cases"
import { createIncomeSourceSchema } from "@/lib/schemas/income-source"
import { z } from "zod"

const periodQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})

// Ingresos programados con su estado en el período del plan (?year=&month=; por defecto el actual).
export async function GET(req: Request) {
  return withUser(req, async (userId) => {
    const params = new URL(req.url).searchParams
    const period = periodQuery.parse({
      year: params.get("year") ?? undefined,
      month: params.get("month") ?? undefined,
    })
    return { sources: await listIncomeSources(financeDeps, userId, period) }
  })
}

export async function POST(req: Request) {
  return withUser(
    req,
    async (userId) => {
      const body = await req.json().catch(() => ({}))
      return createIncomeSource(financeDeps, userId, createIncomeSourceSchema.parse(body))
    },
    201
  )
}
