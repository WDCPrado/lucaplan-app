// Instalación inicial (/setup, WDC-181): solo mientras la base no tiene cuentas, protegida por un
// código que el servidor imprime en su consola. El estado vive en memoria del proceso: reiniciar
// da código nuevo y corta las sesiones del asistente.
import type { IntegrationDeps } from "../integrations/integrations.domain.ts"
import { createRateWindow } from "../../../shared/rate-window.ts"

export const SETUP_COOKIE = "lucaplan_setup"
export const SETUP_SESSION_MS = 60 * 60 * 1000 // la cookie del asistente vence a la hora
export const SETUP_MAX_FAILURES = 5 // códigos incorrectos por IP en una hora
// Códigos incorrectos en total, de cualquier IP: al llegar, el código se rota. Es lo que cierra la
// fuerza bruta aunque alguien reparta los intentos entre muchas IPs.
export const SETUP_MAX_TOTAL_FAILURES = 10

export type SetupState = {
  code: string | null // «ABCD-1234»; null = aún no se generó
  sessions: Map<string, number> // token de la cookie → vence (ms)
  failures: ReturnType<typeof createRateWindow>
  failedTotal: number // incorrectos desde el último código generado
}

export const createSetupState = (): SetupState => ({
  code: null,
  sessions: new Map(),
  failures: createRateWindow(SETUP_MAX_FAILURES, 60 * 60 * 1000),
  failedTotal: 0,
})

export interface InstallationAccounts {
  hasAccounts(): Promise<boolean>
}

export type SetupDeps = {
  accounts: InstallationAccounts
  state: SetupState
  integrations: IntegrationDeps
  env: Record<string, string | undefined>
  now: () => Date
}

/** Token de la cookie del asistente en los headers de la petición, o null. */
export function setupTokenFrom(headers: Headers | null | undefined): string | null {
  const cookie = headers?.get("cookie") ?? ""
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=")
    if (name === SETUP_COOKIE) return rest.join("=") || null
  }
  return null
}

// Ya hay una cuenta: el asistente no existe más. 404.
export class SetupDoneError extends Error {
  constructor() {
    super("La instalación ya está hecha")
    this.name = "SetupDoneError"
  }
}

// Código de instalación incorrecto, o falta la cookie del asistente. 401.
export class SetupUnauthorizedError extends Error {
  constructor(message = "El código de instalación no es correcto") {
    super(message)
    this.name = "SetupUnauthorizedError"
  }
}

// Demasiados códigos incorrectos desde esta IP en la última hora. 429.
export class SetupRateLimitedError extends Error {
  constructor() {
    super("Demasiados intentos. Espera una hora y vuelve a probar")
    this.name = "SetupRateLimitedError"
  }
}
