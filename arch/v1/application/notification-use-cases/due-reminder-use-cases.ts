import {
  DEFAULT_DUE_DAYS,
  InvalidDueDaysError,
  MAX_DUE_DAYS,
  MIN_DUE_DAYS,
  type DueReminderRepository,
} from "../../domain/notifications/due-reminder.domain.ts"

export type DueReminderDeps = { dueReminder: DueReminderRepository }

/** Días de anticipación configurados; sin configurar, el valor por defecto. */
export async function getDueDays(deps: DueReminderDeps): Promise<number> {
  return (await deps.dueReminder.getDays()) ?? DEFAULT_DUE_DAYS
}

export async function setDueDays(
  deps: DueReminderDeps,
  days: number
): Promise<number> {
  const value = Math.round(days)
  if (!Number.isFinite(value) || value < MIN_DUE_DAYS || value > MAX_DUE_DAYS)
    throw new InvalidDueDaysError()
  await deps.dueReminder.setDays(value)
  return value
}
