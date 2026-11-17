// Biometría = passkey (WebAuthn) del plugin de Better Auth. En todo texto que ve la persona es
// «biometría». Aquí solo lo que no depende del navegador: el nombre del aparato y los mensajes.

type PasskeyError = { code?: string; status?: number } | null | undefined

/** Lo que una persona reconoce en la lista: «iPhone · Safari». Máximo 60 caracteres. */
export function passkeyDeviceName(ua: string): string {
  const first = (pairs: [RegExp, string][], fallback: string) =>
    pairs.find(([pattern]) => pattern.test(ua))?.[1] ?? fallback
  const device = first(
    [
      [/iPhone/, "iPhone"],
      [/iPad/, "iPad"],
      [/Android/, "Android"],
      [/Macintosh|Mac OS X/, "Mac"],
    ],
    "Computador"
  )
  const browser = first(
    [
      [/Edg\//, "Edge"],
      [/OPR\//, "Opera"],
      [/Firefox\/|FxiOS/, "Firefox"],
      [/Chrome\/|CriOS/, "Chrome"],
      [/Safari\//, "Safari"],
    ],
    "Navegador"
  )
  return `${device} · ${browser}`.slice(0, 60)
}

// La persona cerró el diálogo del sistema o otra ceremonia tomó su lugar: no es un error.
// NotAllowedError llega como ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY (cancelar y vencer no se
// distinguen, a propósito); AbortError como ERROR_CEREMONY_ABORTED; el resto del cliente, AUTH_CANCELLED.
const CANCEL_CODES = [
  "ERROR_CEREMONY_ABORTED",
  "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
  "AUTH_CANCELLED",
]
export const isPasskeyCancel = (error: PasskeyError) =>
  CANCEL_CODES.includes(error?.code ?? "")

/**
 * Mensaje de un intento fallido de entrar. `chosen`: la persona ya eligió su passkey y se estaba
 * verificando (antes de eso, un cancelar no dice nada). Una cuenta bloqueada responde como una clave
 * mala: no se dice cuál de las dos es.
 */
export function signInPasskeyMessage(
  error: PasskeyError,
  chosen: boolean
): string | null {
  if (!chosen && isPasskeyCancel(error)) return null
  // Tras elegir, AUTH_CANCELLED es que la verificación no llegó al servidor.
  if (chosen && error?.code === "AUTH_CANCELLED")
    return "No se pudo entrar. Revisa la conexión e intenta de nuevo."
  if (error?.code === "PASSKEY_NOT_FOUND")
    return "Este aparato no tiene biometría guardada para tu cuenta. Entra con tu correo y agrégala en Ajustes."
  if (error?.code === "CHALLENGE_NOT_FOUND")
    return "Pasó mucho rato. Intenta de nuevo."
  if (error?.code?.startsWith("ERROR_"))
    return "No se pudo usar la biometría en este aparato. Entra con tu correo."
  if (error?.status === 429)
    return "Has hecho varios intentos. Espera un minuto e inténtalo de nuevo."
  if ([400, 401, 403].includes(error?.status ?? 0))
    return "No pudimos entrar con biometría. Si tu cuenta sigue activa, entra con tu correo."
  return "No se pudo entrar. Revisa la conexión e intenta de nuevo."
}

/** Mensaje de un registro fallido; `null` si la persona canceló. */
export function addPasskeyMessage(error: PasskeyError): string | null {
  if (error?.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED")
    return "Este aparato ya está registrado en tu cuenta."
  if (isPasskeyCancel(error)) return null
  if (error?.code === "CHALLENGE_NOT_FOUND")
    return "Pasó mucho rato. Intenta de nuevo."
  if (error?.code === "SESSION_NOT_FRESH")
    return "Por seguridad, vuelve a iniciar sesión para agregar este aparato."
  if (error?.status === 401)
    return "Tu sesión venció. Vuelve a entrar para agregar este aparato."
  return "No se pudo agregar este aparato. Intenta de nuevo."
}
