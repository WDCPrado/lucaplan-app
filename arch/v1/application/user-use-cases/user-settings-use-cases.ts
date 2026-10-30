// Preferencias de apariencia por usuario. Siempre devuelven el estado completo: lo que falta o
// está corrupto en la base cae al valor por defecto.
import {
  USER_SETTINGS_DEFAULTS,
  userSettingsPatchSchema,
  userSettingsSchema,
  type UserSettings,
} from "../../../../lib/schemas/user-settings.ts"
import type { UserSettingRepository } from "../../domain/user/user-settings.domain.ts"

export type UserSettingsDeps = { userSettings: UserSettingRepository }

// Campo del esquema → clave en la base, y cómo se lee su texto.
const KEYS = {
  glassLevel: {
    key: "glass_level",
    read: (v: string) => (/^-?\d+$/.test(v) ? Number(v) : v),
  },
  theme: { key: "theme", read: (v: string) => v },
} as const satisfies Record<
  keyof UserSettings,
  { key: string; read: (v: string) => unknown }
>

export async function getUserSettings(
  deps: UserSettingsDeps,
  userId: string
): Promise<UserSettings> {
  return (await getUserSettingsState(deps, userId)).settings
}

// Lo mismo más `stored`: si el usuario guardó algo alguna vez (tiene filas). Con eso el front
// distingue «nunca guardó» (puede migrar lo que el dispositivo tenía) de «guardó los defaults».
export async function getUserSettingsState(
  deps: UserSettingsDeps,
  userId: string
): Promise<{ settings: UserSettings; stored: boolean }> {
  const rows = await deps.userSettings.list(userId)
  const settings = { ...USER_SETTINGS_DEFAULTS }
  for (const field of Object.keys(KEYS) as (keyof UserSettings)[]) {
    const raw = rows[KEYS[field].key]
    if (raw === undefined) continue
    const parsed = userSettingsSchema.shape[field].safeParse(
      KEYS[field].read(raw)
    )
    if (parsed.success) Object.assign(settings, { [field]: parsed.data })
  }
  return { settings, stored: Object.keys(rows).length > 0 }
}

// Valida el patch (un patch inválido lanza ZodError), guarda solo lo que vino y devuelve el
// estado completo.
export async function updateUserSettings(
  deps: UserSettingsDeps,
  userId: string,
  patch: unknown
): Promise<UserSettings> {
  const valid = userSettingsPatchSchema.parse(patch)
  const values: Record<string, string> = {}
  for (const [field, value] of Object.entries(valid))
    if (value !== undefined)
      values[KEYS[field as keyof UserSettings].key] = String(value)
  await deps.userSettings.upsert(userId, values)
  return getUserSettings(deps, userId)
}
