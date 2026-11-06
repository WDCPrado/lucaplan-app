// Wiring de las claves de integración: UNA sola IntegrationDeps por proceso, así su caché es la
// misma para quien guarda (PUT /api/integrations) y quien usa la clave (IA, Outlook, Resend), y un
// cambio rige en el siguiente uso sin reiniciar.
// ponytail: caché por proceso; con varias réplicas, otra réplica sigue con lo viejo hasta reiniciar.
import type { IntegrationDeps } from "../../../domain/integrations/integrations.domain.ts"
import { integrationCipher } from "../../crypto/integration-cipher.ts"
import { integrationSettingsRepository } from "./integration-settings.infrastructure.ts"

// En globalThis: Next puede cargar este módulo en más de una instancia (instrumentation, rutas) y
// guardar en una tiene que invalidar la caché que leen las otras.
const g = globalThis as unknown as { lucaplanIntegrationCache?: IntegrationDeps["cache"] }

export const integrationDeps: IntegrationDeps = {
  settings: integrationSettingsRepository,
  cipher: integrationCipher,
  env: process.env,
  cache: (g.lucaplanIntegrationCache ??= new Map()),
}
