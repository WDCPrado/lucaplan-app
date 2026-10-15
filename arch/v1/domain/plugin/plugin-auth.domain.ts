import type { PluginActor } from "./plugin.domain.ts"

// El adaptador autentica la credencial y el estado vigente del permiso en cada llamada.
export interface PluginActorVerifier {
  verify(bearerToken: string): Promise<PluginActor>
}

export type PluginConnection = {
  id: string
  clientId: string
  clientName: string | null
  scopes: string[]
  createdAt: Date
  updatedAt: Date
}

export interface PluginConnectionStore {
  list(userId: string): Promise<PluginConnection[]>
  // Solo la sesión de Luca Plan puede revocar. El id ajeno se trata como inexistente.
  revoke(userId: string, connectionId: string): Promise<boolean>
}
