import { z } from "zod"

// Nombre para mostrar: las mismas reglas que tenía el formulario del perfil (sin vacío, 80 máx.).
export const PROFILE_NAME_MAX = 80
export const profileNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Escribe tu nombre.")
    .max(PROFILE_NAME_MAX, `Máximo ${PROFILE_NAME_MAX} caracteres.`),
})

// Cambio de contraseña: mínimo 8 y la repetición igual a la nueva. La actual la verifica el servidor.
export const PASSWORD_MIN = 8
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Escribe tu contraseña actual."),
    newPassword: z
      .string()
      .min(
        PASSWORD_MIN,
        `La nueva contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`
      ),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Las contraseñas no coinciden.",
  })
