import assert from "node:assert/strict"
import test from "node:test"
import { betterAuth } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import { createAuthMiddleware } from "better-auth/api"
import { admin } from "better-auth/plugins"
import {
  assertLoginCodeRequest,
  createLoginCodePlugin,
  PASSWORD_DISABLED_PATHS,
} from "./login-code.ts"

function fixture({ verified = true, banned = false, rateLimit = false } = {}) {
  const now = new Date()
  const sent: { email: string; code: string }[] = []
  const db: Record<string, Record<string, unknown>[]> = {
    user: [
      {
        id: "existing-user",
        name: "Persona de prueba",
        email: "test@example.com",
        emailVerified: verified,
        banned,
        role: "USER",
        createdAt: now,
        updatedAt: now,
      },
    ],
    session: [
      {
        id: "old-session",
        token: "old-session-token",
        userId: "existing-user",
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 86400000),
      },
    ],
    account: [
      {
        id: "old-account",
        accountId: "existing-user",
        userId: "existing-user",
        providerId: "credential",
        password: "old-hash",
        createdAt: now,
        updatedAt: now,
      },
    ],
    verification: [],
  }
  const auth = betterAuth({
    baseURL: "http://localhost:3154",
    secret: "wdc154-test-secret-only-not-a-real-secret-123456",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: false },
    disabledPaths: PASSWORD_DISABLED_PATHS,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        assertLoginCodeRequest(ctx.path, ctx.body)
      }),
    },
    plugins: [
      createLoginCodePlugin({
        async send(email, code) {
          sent.push({ email, code })
        },
      }),
      admin({ defaultRole: "USER", adminRoles: ["ADMIN"] }),
    ],
    session: { expiresIn: 60 * 60 * 24 * 30 },
    rateLimit: { enabled: rateLimit },
    logger: { disabled: true },
  })
  const post = (path: string, body: unknown) =>
    auth.handler(
      new Request(`http://localhost:3154/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3154",
          "x-forwarded-for": "192.0.2.154",
        },
        body: JSON.stringify(body),
      })
    )
  const send = (email = "test@example.com") =>
    post("/email-otp/send-verification-otp", { email, type: "sign-in" })
  const verify = (code = sent.at(-1)!.code, email = "test@example.com") =>
    post("/sign-in/email-otp", { email, otp: code })
  return { db, sent, post, send, verify }
}

test("OTP inicia sesión con el mismo usuario, dura 30 días y consume el código", async () => {
  const f = fixture()
  assert.equal((await f.send()).status, 200)
  const code = f.sent[0].code
  assert.match(code, /^\d{6}$/)
  assert.ok(!String(f.db.verification[0].value).includes(code))
  assert.ok(
    Math.abs(
      new Date(f.db.verification[0].expiresAt as Date).getTime() -
        Date.now() -
        600000
    ) < 2000
  )
  const response = await f.verify()
  assert.equal(response.status, 200)
  assert.equal((await response.json()).user.id, "existing-user")
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i)
  assert.equal(f.db.user.length, 1)
  assert.equal(f.db.account[0].password, "old-hash")
  assert.ok(f.db.session.some((s) => s.id === "old-session"))
  const session = f.db.session.find((s) => s.id !== "old-session")!
  assert.ok(
    Math.abs(
      new Date(session.expiresAt as Date).getTime() - Date.now() - 30 * 86400000
    ) < 2000
  )
  assert.equal((await f.verify(code)).status, 400)
})

test("primer OTP de correo no verificado revoca acceso previo sin cambiar user.id", async () => {
  const f = fixture({ verified: false })
  await f.send()
  const response = await f.verify()
  assert.equal(response.status, 200)
  assert.equal((await response.json()).user.id, "existing-user")
  assert.equal(f.db.user[0].emailVerified, true)
  assert.ok(!f.db.session.some((s) => s.id === "old-session"))
  assert.ok(!f.db.account.some((a) => a.password === "old-hash"))
})

test("registro cerrado: respuesta uniforme sin enviar ni crear cuenta inexistente", async () => {
  const f = fixture()
  const existing = await f.send()
  const missing = await f.send("missing@example.com")
  assert.equal(missing.status, existing.status)
  assert.deepEqual(await missing.json(), await existing.json())
  assert.equal(f.sent.length, 1)
  assert.equal((await f.verify("123456", "missing@example.com")).status, 400)
  assert.equal(f.db.user.length, 1)
})

test("código erróneo agota tres intentos y ya no acepta el correcto", async () => {
  const f = fixture()
  await f.send()
  const wrong = f.sent[0].code === "000000" ? "111111" : "000000"
  for (let i = 0; i < 3; i++) assert.equal((await f.verify(wrong)).status, 400)
  assert.equal((await f.verify()).status, 403)
  assert.equal(f.db.session.length, 1)
})

test("código vencido no crea sesión y reenviar invalida el anterior", async () => {
  const f = fixture()
  await f.send()
  f.db.verification[0].expiresAt = new Date(Date.now() - 1000)
  assert.equal((await f.verify()).status, 400)
  await f.send()
  const previous = f.sent.at(-1)!.code
  await f.send()
  assert.notEqual(f.sent.at(-1)!.code, previous)
  assert.equal((await f.verify(previous)).status, 400)
  assert.equal((await f.verify()).status, 200)
})

test("dos verificaciones simultáneas del mismo OTP crean solo una sesión", async () => {
  const f = fixture()
  await f.send()
  const responses = await Promise.all([f.verify(), f.verify()])
  assert.equal(responses.filter((r) => r.status === 200).length, 1)
  assert.equal(f.db.session.length, 2)
})

test("cuenta bloqueada no entra aunque posea el código", async () => {
  const f = fixture({ banned: true })
  await f.send()
  assert.equal((await f.verify()).status, 403)
  assert.equal(f.db.session.length, 1)
})

test("password, reset y usos ajenos al acceso quedan deshabilitados", async () => {
  const f = fixture()
  for (const path of PASSWORD_DISABLED_PATHS)
    assert.equal(
      (await f.post(path, { email: "test@example.com", password: "anything" }))
        .status,
      404,
      path
    )
  assert.equal(
    (
      await f.post("/email-otp/send-verification-otp", {
        email: "test@example.com",
        type: "forget-password",
      })
    ).status,
    400
  )
  assert.equal(f.sent.length, 0)
})

test("rate limit del servidor limita solicitudes aunque se omita el contador UI", async () => {
  const f = fixture({ rateLimit: true })
  for (let i = 0; i < 3; i++) assert.equal((await f.send()).status, 200)
  assert.equal((await f.send()).status, 429)
  assert.equal(f.sent.length, 3)
})
