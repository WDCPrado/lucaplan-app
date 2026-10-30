import { z } from "zod"

export const loginEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("Escribe un correo válido.")
export const loginCodeSchema = z
  .string()
  .regex(/^\d{6}$/, "Escribe los 6 dígitos del código.")

/** Solo mensajes locales: no mostramos cuerpos ni detalles de Better Auth/Resend. */
export function loginErrorMessage(
  status: number | undefined,
  verifying = false
) {
  if (status === 429)
    return "Has hecho varios intentos. Espera un minuto e inténtalo de nuevo."
  if (verifying && (status === 400 || status === 401 || status === 403)) {
    return "El código no es válido o venció. Revísalo o pide uno nuevo."
  }
  return verifying
    ? "No se pudo entrar. Revisa la conexión e intenta de nuevo."
    : "No se pudo enviar el código. Revisa la conexión e intenta de nuevo."
}
