// Claves de terceros de la instalación (WDC-181): OpenAI, Outlook y Resend. Se resuelven del
// entorno y, si no están ahí, de lo guardado en Ajustes (cifrado si es secreto). Solo tipos y ports.
import type { IntegrationKey } from "../../../../lib/integration-settings-schemas.ts"

// Una fila guardada: `value` tal cual quedó en la base (cifrado si la clave es secreta).
export type StoredIntegration = { key: IntegrationKey; value: string; updatedAt: Date }

export interface IntegrationSettingsRepository {
  list(): Promise<StoredIntegration[]>
  save(key: IntegrationKey, value: string): Promise<void>
  remove(key: IntegrationKey): Promise<void>
}

// Cifra un secreto a un solo string guardable y lo descifra. `decrypt` lanza si no puede (otra
// llave maestra, valor corrupto).
export interface IntegrationCipher {
  encrypt(plain: string): string
  decrypt(stored: string): string
}

// Lo guardado en Ajustes ya descifrado; null = nada guardado o no se pudo descifrar.
export type ResolvedSetting = { value: string; updatedAt: Date } | null

export type IntegrationDeps = {
  settings: IntegrationSettingsRepository
  cipher: IntegrationCipher
  env: Record<string, string | undefined>
  // Caché de lo guardado, por proceso: vacía = no leída. Guardar la vacía.
  cache: Map<IntegrationKey, ResolvedSetting>
}

// La clave viene de una variable de entorno: manda ella y no se edita desde Ajustes. 409.
export class IntegrationFromEnvError extends Error {
  constructor(key: IntegrationKey) {
    super(`${key} viene de una variable de entorno del servidor; cámbiala ahí`)
    this.name = "IntegrationFromEnvError"
  }
}
