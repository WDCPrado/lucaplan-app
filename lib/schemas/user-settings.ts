import { z } from "zod"

// Preferencias de apariencia POR USUARIO (Ajustes → Apariencia). Las guarda la API en la tabla
// `user_setting`; el front las lee del layout y las cambia con PATCH /api/user-settings.
const GLASS_MSG = "El nivel de vidrio va de 0 a 4."

export const userSettingsSchema = z.object({
  // Nivel del Liquid Glass: 0 = más transparente … 2 = el de siempre … 4 = teñido.
  glassLevel: z.number().int(GLASS_MSG).min(0, GLASS_MSG).max(4, GLASS_MSG),
  theme: z.enum(["light", "dark", "system"], "Tema inválido."),
})

export type UserSettings = z.infer<typeof userSettingsSchema>

// El PATCH manda solo lo que cambió, pero al menos una clave.
export const userSettingsPatchSchema = userSettingsSchema
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "No hay cambios que guardar.",
  })

export type UserSettingsPatch = z.infer<typeof userSettingsPatchSchema>

export const USER_SETTINGS_DEFAULTS: UserSettings = {
  glassLevel: 2,
  // "dark", como la app antes de guardarlo en la base; «system» sigue siendo válido.
  theme: "dark",
}
