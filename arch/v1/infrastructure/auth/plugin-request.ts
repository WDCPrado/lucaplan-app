import { AsyncLocalStorage } from "node:async_hooks"

// La fecha de emisión es el inicio de la solicitud, no el fin de la firma: una renovación
// concurrente que comenzó antes de revocar nunca puede producir una credencial posterior al corte.
type PluginRequest = {
  startedAt: number
  grant?: { userId: string; clientId: string; epoch: number }
}
const requestStartedAt = new AsyncLocalStorage<PluginRequest>()

export function withPluginAuthRequest<T>(operation: () => T): T {
  return requestStartedAt.run({ startedAt: Date.now() }, operation)
}

export function pluginIssuedAt(): number {
  const value = requestStartedAt.getStore()
  if (!value)
    throw new Error("La emisión OAuth requiere una solicitud autenticada.")
  return value.grant?.epoch ?? value.startedAt
}

export function setPluginGrant(
  grant: NonNullable<PluginRequest["grant"]>
): void {
  const request = requestStartedAt.getStore()
  if (!request) throw new Error("Falta el contexto de autorización.")
  request.grant = grant
}

export function getPluginGrant(): NonNullable<PluginRequest["grant"]> {
  const grant = requestStartedAt.getStore()?.grant
  if (!grant) throw new Error("Falta la autorización del grant.")
  return grant
}
