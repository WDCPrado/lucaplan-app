import type { PluginActor } from "../../domain/plugin/plugin.domain.ts"
import type { PluginConnectionStore } from "../../domain/plugin/plugin-auth.domain.ts"

export class PluginAuthenticationError extends Error {
  readonly status = 401
  constructor() {
    super("La conexión no está autorizada. Vuelve a conectar Luca Plan.")
    this.name = "PluginAuthenticationError"
  }
}

export class PluginConnectionNotFoundError extends Error {
  readonly status = 404
  constructor() {
    super("Conexión no encontrada.")
    this.name = "PluginConnectionNotFoundError"
  }
}

type AuthorizationState = {
  user: { id: string; banned: boolean | null } | null
  client: { clientId: string; disabled: boolean | null } | null
  consent: { scopes: string[] } | null
  revokedAt: Date | null
}

// Solo recibe claims después de verificar criptográficamente el JWT en infraestructura.
export function authorizePluginClaims(
  claims: unknown,
  state: AuthorizationState,
  options: { issuer: string; resource: string; now: Date }
): PluginActor {
  const fail = (): never => {
    throw new PluginAuthenticationError()
  }
  if (!claims || typeof claims !== "object" || Array.isArray(claims))
    return fail()
  const c = claims as Record<string, unknown>
  const nowMs = options.now.getTime()
  const validAudience =
    c.aud === options.resource ||
    (Array.isArray(c.aud) &&
      c.aud.every((a) => typeof a === "string") &&
      c.aud.includes(options.resource))
  if (
    c.iss !== options.issuer ||
    !validAudience ||
    typeof c.sub !== "string" ||
    !c.sub.trim() ||
    typeof c.azp !== "string" ||
    !c.azp.trim() ||
    typeof c.exp !== "number" ||
    !Number.isFinite(c.exp) ||
    c.exp * 1000 <= nowMs ||
    (c.nbf !== undefined &&
      (typeof c.nbf !== "number" ||
        !Number.isFinite(c.nbf) ||
        c.nbf * 1000 > nowMs)) ||
    typeof c.plugin_issued_at_ms !== "number" ||
    !Number.isSafeInteger(c.plugin_issued_at_ms) ||
    c.plugin_issued_at_ms <= 0 ||
    c.plugin_issued_at_ms > nowMs + 30_000 ||
    typeof c.scope !== "string"
  )
    return fail()
  const scopes = [...new Set(c.scope.split(" ").filter(Boolean))]
  const known = [
    "openid",
    "email",
    "offline_access",
    "finance:read",
    "finance:write",
  ]
  if (
    !scopes.some(
      (scope) => scope === "finance:read" || scope === "finance:write"
    ) ||
    !scopes.every((scope) => known.includes(scope)) ||
    !state.user ||
    state.user.id !== c.sub ||
    state.user.banned === true ||
    !state.client ||
    state.client.clientId !== c.azp ||
    state.client.disabled === true ||
    !state.consent ||
    !scopes.every((scope) => state.consent!.scopes.includes(scope)) ||
    (state.revokedAt && c.plugin_issued_at_ms <= state.revokedAt.getTime())
  )
    return fail()
  return { userId: c.sub, clientId: c.azp, scopes }
}

export async function revokePluginConnection(
  store: PluginConnectionStore,
  userId: string,
  id: string
): Promise<void> {
  if (!(await store.revoke(userId, id)))
    throw new PluginConnectionNotFoundError()
}
