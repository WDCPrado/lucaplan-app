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
  // Caché de lo guardado, por proceso: la promesa de la lectura, bajo "stored"; vacía = no leída.
  // Guardar la vacía. Es la promesa y no su resultado para que una lectura que estaba en curso no
  // reescriba la caché después de que un guardado la vació.
  cache: Map<"stored", Promise<Map<IntegrationKey, ResolvedSetting>>>
}

// La clave viene de una variable de entorno: manda ella y no se edita desde Ajustes. 409.
export class IntegrationFromEnvError extends Error {
  constructor(key: IntegrationKey) {
    super(`${key} viene de una variable de entorno del servidor; cámbiala ahí`)
    this.name = "IntegrationFromEnvError"
  }
}

// Fuera de local, sin BANCOCHILE_ENC_KEY la llave de cifrado vive en un archivo del contenedor y se
// pierde en el próximo deploy: un secreto guardado con ella deja de descifrarse. 409.
export class IntegrationEncKeyMissingError extends Error {
  constructor() {
    super(
      "Define BANCOCHILE_ENC_KEY (32+ caracteres) en el entorno antes de guardar claves secretas: sin ella se pierden en el próximo deploy"
    )
    this.name = "IntegrationEncKeyMissingError"
  }
}
