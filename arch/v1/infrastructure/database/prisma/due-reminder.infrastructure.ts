// Adapter Prisma de la anticipación del recordatorio de vencimientos. Vive en la tabla global
// `app_setting` bajo la clave `due_days`; un valor corrupto se trata como "sin configurar".
import type { DueReminderRepository } from "../../../domain/notifications/due-reminder.domain.ts"
import { prisma } from "./client.ts"

const KEY = "due_days"

export const dueReminderRepository: DueReminderRepository = {
  async getDays(): Promise<number | null> {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } })
    const days = row ? Number(row.value) : NaN
    return Number.isInteger(days) ? days : null
  },

  async setDays(days: number): Promise<void> {
    const value = String(days)
    await prisma.appSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value },
      update: { value },
    })
  },
}
