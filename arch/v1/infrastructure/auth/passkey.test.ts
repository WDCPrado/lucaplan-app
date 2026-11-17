import assert from "node:assert/strict"
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import test from "node:test"
import { betterAuth } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import { admin } from "better-auth/plugins"
import { createPasskeyPlugin, PASSKEY_DISABLED_PATHS } from "./passkey.ts"

const ORIGIN = "http://localhost:3188"

// Un autenticador de software: firma con P-256 lo mismo que firmaría una huella real.
function softAuthenticator(userId: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
  const jwk = publicKey.export({ format: "jwk" })
  // Clave COSE EC2/ES256: {1: 2, 3: -7, -1: 1, -2: x, -3: y}
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x!, "base64url"),
    Buffer.from([0x22, 0x58, 0x20]),
    Buffer.from(jwk.y!, "base64url"),
  ])
  const credentialID = randomBytes(16).toString("base64url")
  const rpIdHash = createHash("sha256").update("localhost").digest()
  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))
  return {
    row: {
      id: `pk-${userId}-${credentialID.slice(0, 6)}`,
      name: "Pixel · Chrome",
      publicKey: cose.toString("base64"),
      userId,
      credentialID,
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      transports: "internal",
      createdAt: new Date(),
    },
    // Registro con attestation "none": {fmt, attStmt, authData} en CBOR.
    attestation(challenge: string, { uv = true } = {}) {
      const authData = Buffer.concat([
        rpIdHash,
        Buffer.from([uv ? 0x45 : 0x41]), // presencia, (verificación), credencial incluida
        Buffer.alloc(4),
        Buffer.alloc(16), // aaguid
        Buffer.from([0x00, 0x10]),
        Buffer.from(credentialID, "base64url"),
        cose,
      ])
      const attestationObject = Buffer.concat([
        Buffer.from([0xa3, 0x63]), Buffer.from("fmt"), Buffer.from([0x64]), Buffer.from("none"),
        Buffer.from([0x67]), Buffer.from("attStmt"), Buffer.from([0xa0]),
        Buffer.from([0x68]), Buffer.from("authData"), Buffer.from([0x58, authData.length]), authData,
      ])
      return {
        id: credentialID,
        rawId: credentialID,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData("webauthn.create", challenge, ORIGIN).toString("base64url"),
          attestationObject: attestationObject.toString("base64url"),
          transports: ["internal"],
        },
      }
    },
    assertion(challenge: string, { origin = ORIGIN, uv = true } = {}) {
      const clientDataJSON = clientData("webauthn.get", challenge, origin)
      const authData = Buffer.concat([
        rpIdHash,
        Buffer.from([uv ? 0x05 : 0x01]), // presencia y (verificación) del usuario
        Buffer.alloc(4),
      ])
      const signature = sign(
        "sha256",
        Buffer.concat([authData, createHash("sha256").update(clientDataJSON).digest()]),
        privateKey
      )
      return {
        id: credentialID,
        rawId: credentialID,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientDataJSON.toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
      }
    },
  }
}

function fixture({
  // null = sin URL (undefined tomaría el valor por defecto)
  pluginUrl = ORIGIN as string | null,
  baseURL = ORIGIN as string | null,
  requestBase = ORIGIN,
} = {}) {
  const now = new Date()
  const user = (id: string, email: string, banned = false) => ({
    id, name: id, email, emailVerified: true, banned, role: "USER", createdAt: now, updatedAt: now,
  })
  const mine = softAuthenticator("me")
  const other = softAuthenticator("other")
  const blocked = softAuthenticator("blocked")
  const db: Record<string, Record<string, unknown>[]> = {
    user: [
      user("me", "me@example.com"),
      user("other", "other@example.com"),
      user("blocked", "blocked@example.com", true),
    ],
    session: [],
    account: [],
    verification: [],
    passkey: [mine.row, other.row, blocked.row],
  }
  const auth = betterAuth({
    baseURL: baseURL ?? undefined,
    secret: "wdc188-test-secret-only-not-a-real-secret-123456",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: false },
    disabledPaths: PASSKEY_DISABLED_PATHS,
    plugins: [
      admin({ defaultRole: "USER", adminRoles: ["ADMIN"] }),
      createPasskeyPlugin(pluginUrl ?? undefined),
    ],
    rateLimit: { enabled: false },
    logger: { disabled: true },
  })
  // Un navegador mínimo: guarda las cookies que responde el servidor.
  const jar = new Map<string, string>()
  const call = async (method: "GET" | "POST", path: string, body?: unknown) => {
    const res = await auth.handler(
      new Request(`${requestBase}/api/auth${path}`, {
        method,
        headers: {
          origin: ORIGIN,
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    )
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";")
      const i = pair.indexOf("=")
      jar.set(pair.slice(0, i), pair.slice(i + 1))
    }
    return res
  }
  const signIn = async (key = mine, opts?: { origin?: string; uv?: boolean }) => {
    const options = await (await call("GET", "/passkey/generate-authenticate-options")).json()
    return call("POST", "/passkey/verify-authentication", {
      response: key.assertion(options.challenge, opts),
    })
  }
  return { db, jar, call, signIn, mine, other, blocked }
}

test("entrar con passkey no pide sesión ni correo y crea la sesión de su dueño", async () => {
  const f = fixture()
  const res = await f.call("GET", "/passkey/generate-authenticate-options")
  assert.equal(res.status, 200)
  const options = await res.json()
  assert.equal(options.rpId, "localhost")
  assert.ok(options.challenge)
  assert.equal(options.allowCredentials, undefined)
  const signedIn = await f.signIn()
  assert.equal(signedIn.status, 200)
  assert.equal((await signedIn.json()).user.id, "me")
  assert.equal(f.db.session.length, 1)
})

test("una cuenta bloqueada no obtiene sesión con su passkey", async () => {
  const f = fixture()
  const res = await f.signIn(f.blocked)
  assert.equal(res.status, 403)
  assert.equal((await res.json()).code, "BANNED_USER")
  assert.equal(f.db.session.length, 0)
})

test("una passkey desconocida no entra ni crea cuenta", async () => {
  const f = fixture()
  const res = await f.signIn(softAuthenticator("nobody"))
  assert.equal(res.status, 401)
  assert.equal(f.db.user.length, 3)
  assert.equal(f.db.session.length, 0)
})

test("una firma hecha para otro sitio no entra", async () => {
  const f = fixture()
  const res = await f.signIn(f.mine, { origin: "https://otro.example" })
  assert.equal(res.status, 400)
  assert.equal(f.db.session.length, 0)
})

test("registrar sin sesión se rechaza", async () => {
  const f = fixture()
  assert.equal((await f.call("GET", "/passkey/generate-register-options")).status, 401)
  assert.equal(
    (await f.call("POST", "/passkey/verify-registration", { response: {} })).status,
    401
  )
})

test("con sesión, registrar entrega opciones de Luca Plan con credencial guardada en el aparato", async () => {
  const f = fixture()
  await f.signIn()
  const res = await f.call("GET", "/passkey/generate-register-options?name=Pixel%20%C2%B7%20Chrome")
  assert.equal(res.status, 200)
  const options = await res.json()
  assert.equal(options.rp.name, "Luca Plan")
  assert.equal(options.rp.id, "localhost")
  assert.equal(options.authenticatorSelection.residentKey, "required")
  // El selector del aparato muestra la cuenta, no el nombre del aparato.
  assert.equal(options.user.name, "me@example.com")
  assert.deepEqual(
    options.excludeCredentials.map((c: { id: string }) => c.id),
    [f.mine.row.credentialID]
  )
})

test("un nombre de más de 60 caracteres se rechaza al registrar", async () => {
  const f = fixture()
  await f.signIn()
  const res = await f.call("POST", "/passkey/verify-registration", {
    response: {},
    name: "x".repeat(61),
  })
  assert.equal(res.status, 400)
  assert.match((await res.json()).message, /60 caracteres/)
  assert.equal(f.db.passkey.length, 3)
})

test("listar devuelve solo las passkeys propias", async () => {
  const f = fixture()
  assert.equal((await f.call("GET", "/passkey/list-user-passkeys")).status, 401)
  await f.signIn()
  const list = await (await f.call("GET", "/passkey/list-user-passkeys")).json()
  assert.deepEqual(
    list.map((p: { id: string; name: string }) => [p.id, p.name]),
    [[f.mine.row.id, "Pixel · Chrome"]]
  )
})

test("quitar una ajena falla y no borra; la propia se quita aunque sea la última", async () => {
  const f = fixture()
  await f.signIn()
  const foreign = await f.call("POST", "/passkey/delete-passkey", { id: f.other.row.id })
  assert.notEqual(foreign.status, 200)
  assert.ok(f.db.passkey.some((p) => p.id === f.other.row.id))
  const own = await f.call("POST", "/passkey/delete-passkey", { id: f.mine.row.id })
  assert.equal(own.status, 200)
  assert.ok(!f.db.passkey.some((p) => p.userId === "me"))
  assert.equal(f.db.passkey.length, 2)
})

test("renombrar está deshabilitado", async () => {
  const f = fixture()
  await f.signIn()
  const res = await f.call("POST", "/passkey/update-passkey", { id: f.mine.row.id, name: "otro" })
  assert.equal(res.status, 404)
  assert.equal(f.db.passkey.find((p) => p.id === f.mine.row.id)!.name, "Pixel · Chrome")
})

test("una firma sin verificar a la persona (huella, cara o PIN) no entra", async () => {
  const f = fixture()
  const res = await f.signIn(f.mine, { uv: false })
  assert.equal(res.status, 401)
  assert.equal((await res.json()).code, "PASSKEY_USER_NOT_VERIFIED")
  assert.equal(f.db.session.length, 0)
})

test("registrar guarda la passkey solo si el aparato verificó a la persona", async () => {
  const f = fixture()
  await f.signIn()
  const register = async (uv: boolean) => {
    const key = softAuthenticator("me")
    const options = await (await f.call("GET", "/passkey/generate-register-options")).json()
    assert.equal(options.authenticatorSelection.userVerification, "required")
    const res = await f.call("POST", "/passkey/verify-registration", {
      response: key.attestation(options.challenge, { uv }),
      name: "Mac · Safari",
    })
    return { res, key }
  }
  const sinUv = await register(false)
  assert.equal(sinUv.res.status, 400)
  assert.equal((await sinUv.res.json()).code, "PASSKEY_USER_NOT_VERIFIED")
  assert.equal(f.db.passkey.length, 3)
  const conUv = await register(true)
  assert.equal(conUv.res.status, 200)
  const saved = f.db.passkey.find((p) => p.credentialID === conUv.key.row.credentialID)!
  assert.equal(saved.userId, "me")
  assert.equal(saved.name, "Mac · Safari")
})

test("registrar con una sesión de más de un día pide volver a entrar", async () => {
  const f = fixture()
  await f.signIn()
  f.db.session[0].createdAt = new Date(Date.now() - 2 * 86400000)
  const res = await f.call("GET", "/passkey/generate-register-options")
  assert.equal(res.status, 403)
  assert.equal((await res.json()).code, "SESSION_NOT_FRESH")
})

test("sin URL, el dominio de la passkey es el host del pedido", async () => {
  const saved = process.env.BETTER_AUTH_URL
  delete process.env.BETTER_AUTH_URL
  try {
    const f = fixture({ pluginUrl: null, baseURL: null, requestBase: "http://10.0.0.5:8080" })
    const options = await (await f.call("GET", "/passkey/generate-authenticate-options")).json()
    assert.equal(options.rpId, "10.0.0.5")
  } finally {
    if (saved !== undefined) process.env.BETTER_AUTH_URL = saved
  }
})

test("con la URL del PR, el dominio de la passkey es el público aunque el pedido llegue por la red interna", async () => {
  const f = fixture({
    pluginUrl: "https://lucaplan-app-pr-3.up.railway.app",
    baseURL: null,
    requestBase: "http://10.0.0.5:8080",
  })
  const options = await (await f.call("GET", "/passkey/generate-authenticate-options")).json()
  assert.equal(options.rpId, "lucaplan-app-pr-3.up.railway.app")
})
