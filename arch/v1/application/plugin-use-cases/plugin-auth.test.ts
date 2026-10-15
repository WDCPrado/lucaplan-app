// Política pura: el adapter ya comprobó la firma JWT. Sin Next, red ni base de datos.
// Los recorridos del Canvas requieren QA humano; aquí se prueba política y contrato.
import { test } from "node:test"
import assert from "node:assert/strict"
import type { PluginConnectionStore } from "../../domain/plugin/plugin-auth.domain.ts"
import { pluginConsentSchema } from "../../../../lib/schemas/plugin-auth.ts"

const now = new Date("2026-10-15T15:00:00.800Z")
const nowMs = now.getTime()
const nowSeconds = Math.floor(nowMs / 1000)
const options = {
  issuer: "https://luca.example/api/auth",
  resource: "https://luca.example/api/mcp",
  now,
}

const claims = (patch: Record<string, unknown> = {}) => ({
  iss: options.issuer,
  aud: options.resource,
  sub: "usuario-a",
  azp: "cliente-a",
  exp: nowSeconds + 600,
  iat: nowSeconds,
  scope: "openid email offline_access finance:read finance:write",
  plugin_issued_at_ms: nowMs - 100,
  ...patch,
})

const state = () => ({
  user: { id: "usuario-a", banned: false as boolean | null },
  client: { clientId: "cliente-a", disabled: false as boolean | null },
  consent: {
    scopes: ["openid", "email", "offline_access", "finance:read", "finance:write"],
  },
  revokedAt: null as Date | null,
})

function authenticationError(error: unknown) {
  assert.ok(error instanceof Error)
  assert.equal(error.name, "PluginAuthenticationError")
  assert.equal(Reflect.get(error, "status"), 401)
  // El cuerpo de error no debe reflejar claims, emails o tokens de la solicitud.
  for (const secret of ["dato-secreto", "ajeno@example.cl", "Bearer secreto"]) {
    assert.equal(error.message.includes(secret), false)
  }
  return true
}

test("Dada una solicitud del asistente, cuando su credencial no identifica al usuario y al cliente de Luca Plan o apunta a otro servicio, entonces se rechaza sin revelar su contenido.", async () => {
  const { authorizePluginClaims } = await import("./plugin-auth-use-cases.ts")
  const malformed: unknown[] = [
    null,
    "Bearer secreto",
    [],
    {},
    claims({ iss: "https://otro.example/dato-secreto" }),
    claims({ aud: `${options.resource}/otro` }),
    claims({ aud: ["https://otro.example/api/mcp"] }),
    claims({ aud: null }),
    claims({ sub: "" }),
    claims({ sub: undefined }),
    claims({ sub: 123 }),
    claims({ azp: undefined }),
    claims({ azp: "" }),
    claims({ exp: undefined }),
    claims({ exp: "dato-secreto" }),
    claims({ exp: NaN }),
    claims({ exp: Infinity }),
    claims({ scope: undefined }),
    claims({ scope: "openid email" }),
    claims({ scope: "openid finance:read admin:all" }),
    claims({ scope: ["finance:read"] }),
    ...[undefined, "dato-secreto", NaN, Infinity, -1, 0, nowMs - 0.5, nowMs + 30_001]
      .map((value) => claims({ plugin_issued_at_ms: value })),
  ]
  for (const input of malformed) {
    assert.throws(() => authorizePluginClaims(input, state(), options), authenticationError)
  }
  for (const aud of [options.resource, ["https://otro.example", options.resource]]) {
    assert.equal(authorizePluginClaims(claims({ aud }), state(), options).userId, "usuario-a")
  }
  assert.equal(
    authorizePluginClaims(claims({ plugin_issued_at_ms: nowMs + 30_000 }), state(), options).userId,
    "usuario-a"
  )
})

test("Dada una conexión autorizada, cuando el asistente usa una credencial vencida o todavía no vigente, entonces se rechaza; justo antes del vencimiento y desde el inicio de vigencia se acepta.", async () => {
  const { authorizePluginClaims } = await import("./plugin-auth-use-cases.ts")
  const boundary = (nowSeconds + 100) * 1000
  const token = claims({ exp: boundary / 1000 })
  assert.equal(authorizePluginClaims(token, state(), { ...options, now: new Date(boundary - 1) }).userId, "usuario-a")
  for (const ms of [boundary, boundary + 1]) {
    assert.throws(() => authorizePluginClaims(token, state(), { ...options, now: new Date(ms) }), authenticationError)
  }
  const notYet = claims({ nbf: boundary / 1000 })
  assert.throws(() => authorizePluginClaims(notYet, state(), { ...options, now: new Date(boundary - 1) }), authenticationError)
  for (const ms of [boundary, boundary + 1]) {
    assert.equal(authorizePluginClaims(notYet, state(), { ...options, now: new Date(ms) }).userId, "usuario-a")
  }
  for (const nbf of ["dato-secreto", NaN, Infinity]) {
    assert.throws(() => authorizePluginClaims(claims({ nbf }), state(), options), authenticationError)
  }
})

test("Dado que revoco una conexión, cuando el asistente vuelve a usar una credencial emitida antes o en el mismo milisegundo de la revocación, entonces pierde el acceso.", async () => {
  const { authorizePluginClaims } = await import("./plugin-auth-use-cases.ts")
  const cutoff = nowMs - 100
  const revokedState = { ...state(), revokedAt: new Date(cutoff) }
  for (const ms of [cutoff - 1, cutoff]) {
    assert.throws(() => authorizePluginClaims(claims({ plugin_issued_at_ms: ms }), revokedState, options), authenticationError)
  }
  assert.equal(authorizePluginClaims(claims({ plugin_issued_at_ms: cutoff + 1 }), revokedState, options).userId, "usuario-a")
})

test("Dado que revoqué y vuelvo a conectar mi cuenta dentro del mismo segundo, cuando el asistente usa la credencial nueva, entonces puede entrar y la anterior sigue rechazada.", async () => {
  const { authorizePluginClaims } = await import("./plugin-auth-use-cases.ts")
  const cutoff = nowSeconds * 1000 + 400
  const oldToken = claims({ plugin_issued_at_ms: cutoff - 1 })
  const renewedToken = claims({ plugin_issued_at_ms: cutoff + 1 })
  assert.equal(oldToken.iat, renewedToken.iat)
  const reconnectedState = { ...state(), revokedAt: new Date(cutoff) }
  assert.throws(() => authorizePluginClaims(oldToken, reconnectedState, options), authenticationError)
  assert.equal(authorizePluginClaims(renewedToken, reconnectedState, options).userId, "usuario-a")
  assert.throws(() => authorizePluginClaims(oldToken, reconnectedState, options), authenticationError)
})

test("Dada una credencial válida, cuando el usuario ya no existe, está bloqueado o el cliente está deshabilitado, entonces el asistente pierde el acceso de inmediato.", async () => {
  const { authorizePluginClaims } = await import("./plugin-auth-use-cases.ts")
  for (const patch of [
    { user: null },
    { user: { id: "usuario-a", banned: true } },
    { user: { id: "usuario-ajeno", banned: false } },
    { client: null },
    { client: { clientId: "cliente-a", disabled: true } },
    { client: { clientId: "cliente-ajeno", disabled: false } },
  ]) {
    assert.throws(() => authorizePluginClaims(claims(), { ...state(), ...patch }, options), authenticationError)
  }
  assert.equal(authorizePluginClaims(claims(), {
    ...state(),
    user: { id: "usuario-a", banned: null },
    client: { clientId: "cliente-a", disabled: null },
  }, options).userId, "usuario-a")
})

test("Dada una conexión, cuando falta el consentimiento vigente o la credencial pide permisos que ya no concedí, entonces se rechaza aunque conserve otros permisos autorizados.", async () => {
  const { authorizePluginClaims } = await import("./plugin-auth-use-cases.ts")
  for (const consent of [null, { scopes: [] }, { scopes: ["openid", "finance:read"] }]) {
    assert.throws(() => authorizePluginClaims(claims(), { ...state(), consent }, options), authenticationError)
  }
  for (const scope of ["finance:read", "finance:write", "openid finance:read", "openid finance:write"]) {
    const permissions = scope.split(" ")
    const actor = authorizePluginClaims(claims({ scope }), { ...state(), consent: { scopes: permissions } }, options)
    assert.deepEqual([...actor.scopes].sort(), [...permissions].sort())
  }
})

test("Dada mi conexión válida, cuando el asistente actúa aunque el mensaje o un correo diga otra identidad, entonces el usuario y los permisos efectivos salen solo de la credencial verificada.", async () => {
  const { authorizePluginClaims } = await import("./plugin-auth-use-cases.ts")
  const actor = authorizePluginClaims(claims({
    email: "ajeno@example.cl",
    userId: "usuario-ajeno",
    clientId: "cliente-ajeno",
    scope: "openid finance:read",
  }), state(), options)
  assert.equal(actor.userId, "usuario-a")
  assert.equal(actor.clientId, "cliente-a")
  assert.deepEqual([...actor.scopes].sort(), ["finance:read", "openid"])
  assert.equal(actor.scopes.includes("finance:write"), false)
})

test("Dada la solicitud de conexión, cuando autorizo o cancelo, entonces se envía esa decisión explícita junto con la solicitud OAuth original obligatoria.", () => {
  // El esquema conserva la query; su firma y la decisión se aplican en el provider OAuth.
  const oauthQuery = "client_id=cliente-a&scope=openid%20finance%3Aread&sig=firma-de-prueba"
  for (const accept of [true, false]) {
    assert.deepEqual(pluginConsentSchema.parse({ accept, oauth_query: oauthQuery }), {
      accept,
      oauth_query: oauthQuery,
    })
    for (const oauth_query of [undefined, ""]) {
      assert.equal(pluginConsentSchema.safeParse({ accept, oauth_query }).success, false)
    }
  }
  for (const accept of [undefined, "true", "false", 0, 1]) {
    assert.equal(pluginConsentSchema.safeParse({ accept, oauth_query: oauthQuery }).success, false)
  }
})

test("Dada una solicitud de consentimiento, cuando alguien agrega un correo, usuario o cliente para elegir otra cuenta, entonces el servidor rechaza esos campos adicionales.", () => {
  const input = { accept: true, oauth_query: "client_id=cliente-a&sig=firma-de-prueba" }
  for (const key of ["userId", "user_id", "email", "clientId", "client_id", "role"]) {
    assert.equal(pluginConsentSchema.safeParse({ ...input, [key]: "ajeno@example.cl" }).success, false)
  }
})

test("Dadas conexiones de dos usuarios, cuando revoco una desde mi sesión, entonces solo se revoca la mía y una conexión ajena responde igual que una inexistente.", async () => {
  const { revokePluginConnection } = await import("./plugin-auth-use-cases.ts")
  const owners = new Map([["conexion-a", "usuario-a"], ["conexion-b", "usuario-b"]])
  const calls: [string, string][] = []
  const store: PluginConnectionStore = {
    async list() { throw new Error("Revocar no necesita listar conexiones") },
    async revoke(userId, id) {
      calls.push([userId, id])
      if (owners.get(id) !== userId) return false
      owners.delete(id)
      return true
    },
  }
  assert.equal(await revokePluginConnection(store, "usuario-a", "conexion-a"), undefined)
  assert.equal(owners.has("conexion-a"), false)
  const errors: Error[] = []
  for (const id of ["conexion-b", "inexistente"]) {
    await assert.rejects(() => revokePluginConnection(store, "usuario-a", id), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.name, "PluginConnectionNotFoundError")
      assert.equal(Reflect.get(error, "status"), 404)
      errors.push(error)
      return true
    })
  }
  assert.equal(errors[0].message, errors[1].message)
  assert.equal(owners.get("conexion-b"), "usuario-b")
  assert.deepEqual(calls, [
    ["usuario-a", "conexion-a"],
    ["usuario-a", "conexion-b"],
    ["usuario-a", "inexistente"],
  ])
})
