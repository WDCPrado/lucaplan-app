import {
  withUser,
  financeDeps,
  periodOf,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  generateMonthlyIncome,
  ungenerateMonthlyIncome,
} from "@/arch/v1/application/finance-use-cases/income-use-cases"

// Genera el movimiento de ingreso del mes (por query ?year&month; default mes actual) desde la fuente.
// Idempotente: si ya se generó ese mes, devuelve el existente sin duplicar.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const { year, month } = await periodOf(req)
  return withUser(req, (userId) =>
    generateMonthlyIncome(financeDeps, userId, { incomeId: id, year, month })
  )
}

// Deshace la generación del mes (borra el movimiento y revierte el saldo) — para corregir un error.
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const { year, month } = await periodOf(req)
  return withUser(req, (userId) =>
    ungenerateMonthlyIncome(financeDeps, userId, { incomeId: id, year, month })
  )
}
