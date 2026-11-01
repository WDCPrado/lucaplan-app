// Adapter Prisma del período del presupuesto. Vive en la tabla global `app_setting`: el modo bajo
// `budget_period_mode` y cada cierre corregido bajo `card_closing:YYYY-MM`. Un modo corrupto se
// trata como "sin configurar".
import {
  PERIOD_MODES,
  type BudgetPeriodRepository,
} from "../../../domain/finance/budget-period.domain.ts"
import type {
  ClosingOverrides,
  PeriodMode,
} from "../../../../shared/billing-cycle.ts"
import { prisma } from "./client.ts"
import type { Prisma } from "./generated/client.ts"

const MODE_KEY = "budget_period_mode"
const CLOSING_PREFIX = "card_closing:"
const closingKey = (year: number, month: number) =>
  `${CLOSING_PREFIX}${year}-${String(month).padStart(2, "0")}`

/** También se usa dentro de la transacción serializable del reembolso. */
export async function budgetPeriodSettings(db: Pick<Prisma.TransactionClient, "appSetting"> = prisma) {
  const rows = await db.appSetting.findMany({ where: {
    OR: [{ key: MODE_KEY }, { key: { startsWith: CLOSING_PREFIX } }],
  } })
  let mode: PeriodMode = "calendar"
  const overrides: ClosingOverrides = {}
  for (const row of rows) {
    if (row.key === MODE_KEY) {
      if ((PERIOD_MODES as readonly string[]).includes(row.value)) mode = row.value as PeriodMode
    } else overrides[row.key.slice(CLOSING_PREFIX.length)] = row.value
  }
  return { mode, overrides }
}

export const budgetPeriodRepository: BudgetPeriodRepository = {
  async get() {
    // Una sola lectura para el modo y todos los cierres: son pocas filas (una por mes corregido).
    const rows = await prisma.appSetting.findMany({
      where: {
        OR: [{ key: MODE_KEY }, { key: { startsWith: CLOSING_PREFIX } }],
      },
    })
    let mode: PeriodMode | null = null
    const overrides: ClosingOverrides = {}
    for (const row of rows) {
      if (row.key === MODE_KEY) {
        if ((PERIOD_MODES as readonly string[]).includes(row.value))
          mode = row.value as PeriodMode
      } else overrides[row.key.slice(CLOSING_PREFIX.length)] = row.value
    }
    return { mode, overrides }
  },

  async setMode(mode) {
    await prisma.appSetting.upsert({
      where: { key: MODE_KEY },
      create: { key: MODE_KEY, value: mode },
      update: { value: mode },
    })
  },

  async setClosing(year, month, date) {
    const key = closingKey(year, month)
    if (date === null) {
      await prisma.appSetting.deleteMany({ where: { key } })
      return
    }
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: date },
      update: { value: date },
    })
  },
}
