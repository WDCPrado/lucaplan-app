import type { EscenaContext } from "../sembrar-usuario.ts"
import { todayKey } from "../../../arch/shared/today.ts"

export const correo = "wdc-166@lucaplan.cl"
export const titulo = "WDC-166 — planes independientes por modo"

export async function seed({ prisma, userId, categoryId }: EscenaContext) {
  const today = todayKey()
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const category = categoryId.get("Supermercado")!
  const income = await prisma.income.findFirstOrThrow({ where: { userId } })
  for (const [mode, globalLimit, limitAmount, amount] of [
    ["calendar", 1000000, 200000, 1400000],
    ["card_cycle", 1800000, 400000, 2000000],
  ] as const) {
    await prisma.monthlyBudget.upsert({
      where: { userId_mode_year_month: { userId, mode, year, month } },
      create: { userId, mode, year, month, globalLimit }, update: { globalLimit },
    })
    await prisma.categoryLimit.upsert({
      where: { categoryId_mode_year_month: { categoryId: category, mode, year, month } },
      create: { categoryId: category, mode, year, month, limitAmount }, update: { limitAmount },
    })
    await prisma.incomeAmount.upsert({
      where: { incomeId_mode_year_month: { incomeId: income.id, mode, year, month } },
      create: { incomeId: income.id, mode, year, month, amount }, update: { amount },
    })
  }
}
