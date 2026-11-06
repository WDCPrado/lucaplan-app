// La primera cuenta de una instalación nueva (WDC-181): con la base vacía, pedir el código o
// registrarse exige la cookie de setup verificada, y solo esa cuenta queda ADMIN. Plugin real de
// better-auth con base en memoria; el hook de creación replica el que irá en auth.ts.
// Corre con: node --test arch/v1/application/setup-use-cases/setup-signup.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { betterAuth } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import { createLoginCodePlugin } from "../../infrastructure/auth/login-code.ts"
import { ensureSetupCode, verifySetupCode, promoteFirstAccount, isSetupVerified } from "./setup-use-cases.ts"
import { createSetupState, setupTokenFrom, SETUP_COOKIE, type SetupDeps } from "../../domain/setup/setup.domain.ts"
import type { FirstAdminRepository } from "../../domain/user/user.domain.ts"

process.env.BANCOCHILE_ENC_KEY = "wdc181-llave-maestra-de-prueba-0123456789abcdef"

type Env = Record<string, string | undefined>
const now = new Date()
const demo = () => ({ id: "demo", name: "Demo", email: "demo@lucaplan.cl", emailVerified: true, role: "USER", createdAt: now, updatedAt: now })

function fixture(env: Env, initialUsers: Record<string, unknown>[] = []) {
  const sent: { email: string; code: string }[] = []
  const db: Record<string, Record<string, unknown>[]> = { user: initialUsers, session: [], account: [], verification: [] }
  const setup: SetupDeps = {
    accounts: { async hasAccounts() { return db.user.length > 0 } },
    state: createSetupState(),
    integrations: {
      settings: { async list() { return [] }, async save() {}, async remove() {} },
      cipher: { encrypt: (v) => v, decrypt: (v) => v },
      env,
      cache: new Map(),
    },
    env,
    now: () => new Date(),
  }
  // Mismo UPDATE atómico que el adapter Prisma: solo si es la única cuenta.
  const users: FirstAdminRepository = {
    async promoteIfOnlyUser(id) {
      if (db.user.length !== 1 || db.user[0].id !== id) return false
      db.user[0].role = "ADMIN"
      return true
    },
  }
  const auth = betterAuth({
    baseURL: "http://localhost:3181",
    secret: "wdc181-test-secret-only-not-a-real-secret-123456",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: false },
    user: { additionalFields: { role: { type: "string", defaultValue: "USER", input: false } } },
    plugins: [
      createLoginCodePlugin({ async send(email, code) { sent.push({ email, code }) } }, env, {
        hasAccounts: () => setup.accounts.hasAccounts(),
        isVerified: (headers) => isSetupVerified(setup, setupTokenFrom(headers)),
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user, ctx) => {
            await promoteFirstAccount(setup, users, user.id, setupTokenFrom(ctx?.headers ?? null))
          },
        },
      },
    },
    rateLimit: { enabled: false },
    logger: { disabled: true },
  })
  const post = (path: string, body: unknown, cookie?: string) =>
    auth.handler(
      new Request(`http://localhost:3181/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3181",
          ...(cookie ? { cookie: `${SETUP_COOKIE}=${cookie}` } : {}),
        },
        body: JSON.stringify(body),
      })
    )
  const send = async (email: string, cookie?: string) => {
    const res = await post("/email-otp/send-verification-otp", { email, type: "sign-in" }, cookie)
    await new Promise((r) => setImmediate(r))
    return res
  }
  const verify = (email: string, otp: string, cookie?: string) => post("/sign-in/email-otp", { email, otp }, cookie)
  const setupCookie = async () => {
    const log = console.log
    console.log = () => {}
    try {
      const code = await ensureSetupCode(setup)
      return await verifySetupCode(setup, { code: code! }, "203.0.113.7")
    } finally {
      console.log = log
    }
  }
  return { db, sent, send, verify, setupCookie }
}

test("con la base vacía y sin la cookie de setup, un correo nuevo no recibe código ni se crea cuenta, también con SIGNUP_OPEN y en local", async () => {
  // Respuesta de referencia: registro cerrado en producción con una cuenta ya creada.
  const closed = fixture({ NODE_ENV: "production" }, [demo()])
  const reference = await (await closed.send("nueva@example.com")).json()

  for (const env of [
    { NODE_ENV: "production" },
    { NODE_ENV: "production", SIGNUP_OPEN: "true" },
    { NODE_ENV: "development" }, // local: el registro normal estaría abierto
  ] as Env[]) {
    const f = fixture(env)
    const res = await f.send("nueva@example.com")
    assert.equal(res.status, 200, JSON.stringify(env))
    assert.deepEqual(await res.json(), reference, JSON.stringify(env))
    assert.equal(f.sent.length, 0, JSON.stringify(env))
    // Borde: una cookie inventada tampoco abre la puerta.
    await f.send("nueva@example.com", "inventada")
    assert.equal(f.sent.length, 0)
    assert.equal((await f.verify("nueva@example.com", "123456")).status, 400)
    assert.equal(f.db.user.length, 0, JSON.stringify(env))
  }
  // Borde: en local, la demo con 000000 tampoco crea la primera cuenta sin cookie.
  const local = fixture({ NODE_ENV: "development" })
  await local.send("demo@lucaplan.cl")
  assert.equal((await local.verify("demo@lucaplan.cl", "000000")).status, 400)
  assert.equal(local.db.user.length, 0)
})

test("con la base vacía y la cookie de setup, la cuenta se crea y queda ADMIN; después el registro vuelve a la regla normal y las siguientes quedan USER", async () => {
  const f = fixture({ NODE_ENV: "production" }) // sin SIGNUP_OPEN
  const cookie = await f.setupCookie()
  assert.equal((await f.send("willy@example.com", cookie)).status, 200)
  assert.equal(f.sent.length, 1)
  assert.equal((await f.verify("willy@example.com", f.sent[0].code, cookie)).status, 200)
  assert.equal(f.db.user.length, 1)
  assert.equal(f.db.user[0].email, "willy@example.com")
  assert.equal(f.db.user[0].role, "ADMIN")

  // Ya hay una cuenta: la cookie no sirve más y el registro cerrado de producción manda.
  await f.send("otra@example.com", cookie)
  assert.equal(f.sent.length, 1, "con el registro cerrado no se envía código")
  assert.equal((await f.verify("otra@example.com", "123456", cookie)).status, 400)
  assert.equal(f.db.user.length, 1)

  // Con SIGNUP_OPEN=true, después de la primera cuenta, la siguiente entra pero queda USER.
  const open = fixture({ NODE_ENV: "production", SIGNUP_OPEN: "true" })
  const c2 = await open.setupCookie()
  await open.send("willy@example.com", c2)
  await open.verify("willy@example.com", open.sent[0].code, c2)
  await open.send("ana@example.com", c2)
  assert.equal((await open.verify("ana@example.com", open.sent[1].code, c2)).status, 200)
  const roles = Object.fromEntries(open.db.user.map((u) => [u.email, u.role]))
  assert.deepEqual(roles, { "willy@example.com": "ADMIN", "ana@example.com": "USER" })
})
