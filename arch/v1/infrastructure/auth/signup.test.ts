// Registro abierto con código por correo (WDC-181). Plugin real de better-auth con memory adapter.
// Corre con: node --test arch/v1/infrastructure/auth/signup.test.ts
import assert from "node:assert/strict"
import test from "node:test"
import { betterAuth } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import { createLoginCodePlugin } from "./login-code.ts"
import { createResendLoginCodeMailer } from "../email/resend/login-code.mailer.ts"
import { seedDefaultCategories } from "../../application/finance-use-cases/seed-default-categories-use-case.ts"
import type {
  CategoryInput,
  CategoryRepository,
} from "../../domain/finance/finance.domain.ts"

type Env = Record<string, string | undefined>

// Cuenta existente: la demo. El hook de creación replica el de auth.ts (siembra del set precreado).
function fixture(env: Env) {
  const now = new Date()
  const sent: { email: string; code: string }[] = []
  const seeded: CategoryInput[] = []
  const categories = {
    async listByUser(userId: string) {
      return seeded.filter((c) => c.userId === userId)
    },
    async createMany(inputs: CategoryInput[]) {
      seeded.push(...inputs)
    },
  } as unknown as CategoryRepository
  const db: Record<string, Record<string, unknown>[]> = {
    user: [
      { id: "demo", name: "Demo", email: "demo@lucaplan.cl", emailVerified: true, createdAt: now, updatedAt: now },
    ],
    session: [],
    account: [],
    verification: [],
  }
  const auth = betterAuth({
    baseURL: "http://localhost:3181",
    secret: "wdc181-test-secret-only-not-a-real-secret-123456",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: false },
    plugins: [
      createLoginCodePlugin(
        {
          async send(email, code) {
            sent.push({ email, code })
          },
        },
        env
      ),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await seedDefaultCategories({ categories }, user.id)
          },
        },
      },
    },
    rateLimit: { enabled: false },
    logger: { disabled: true },
  })
  const post = (path: string, body: unknown) =>
    auth.handler(
      new Request(`http://localhost:3181/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3181" },
        body: JSON.stringify(body),
      })
    )
  const send = async (email: string) => {
    const res = await post("/email-otp/send-verification-otp", { email, type: "sign-in" })
    await new Promise((r) => setImmediate(r)) // el envío corre fuera de la respuesta
    return res
  }
  const verify = (email: string, otp: string) => post("/sign-in/email-otp", { email, otp })
  return { db, sent, seeded, send, verify }
}

test("registro abierto: un correo nuevo pide su código, entra y su cuenta parte con el set precreado (SIGNUP_OPEN=true en producción, o en desarrollo)", async () => {
  for (const env of [
    { NODE_ENV: "production", SIGNUP_OPEN: "true" },
    { NODE_ENV: "development" }, // en local siempre abierto, sin la variable
  ] as Env[]) {
    const f = fixture(env)
    assert.equal((await f.send("nueva@example.com")).status, 200)
    assert.equal(f.sent.length, 1, JSON.stringify(env))
    assert.match(f.sent[0].code, /^\d{6}$/)
    assert.notEqual(f.sent[0].code, "000000") // el código fijo es solo de la demo
    const res = await f.verify("nueva@example.com", f.sent[0].code)
    assert.equal(res.status, 200, JSON.stringify(env))
    const user = f.db.user.find((u) => u.email === "nueva@example.com")
    assert.ok(user, "la cuenta queda creada")
    assert.equal(f.seeded.filter((c) => c.userId === user!.id).length, 10)
  }
})

test("registro cerrado en producción: un correo nuevo recibe la misma respuesta que uno existente, sin código ni cuenta", async () => {
  // Borde: solo "true" exacto abre; ausente, "false", "1" o "TRUE" lo dejan cerrado.
  for (const env of [
    { NODE_ENV: "production" },
    { NODE_ENV: "production", SIGNUP_OPEN: "false" },
    { NODE_ENV: "production", SIGNUP_OPEN: "1" },
    { NODE_ENV: "production", SIGNUP_OPEN: "TRUE" },
  ] as Env[]) {
    const f = fixture(env)
    const existing = await f.send("demo@lucaplan.cl")
    const missing = await f.send("nueva@example.com")
    assert.equal(missing.status, existing.status, JSON.stringify(env))
    assert.deepEqual(await missing.json(), await existing.json())
    assert.ok(!f.sent.some((s) => s.email === "nueva@example.com"), JSON.stringify(env))
    assert.equal((await f.verify("nueva@example.com", "123456")).status, 400)
    assert.equal(f.db.user.length, 1)
  }
})

test("la cuenta demo sigue entrando con 000000 en local aunque el registro esté abierto", async () => {
  const f = fixture({ NODE_ENV: "development", SIGNUP_OPEN: "true" })
  await f.send("demo@lucaplan.cl")
  assert.equal(f.sent.length, 0) // la demo no recibe correo
  assert.equal((await f.verify("demo@lucaplan.cl", "000000")).status, 200)
  // En producción, aunque el registro esté abierto, 000000 no sirve para nadie.
  const prod = fixture({ NODE_ENV: "production", SIGNUP_OPEN: "true" })
  await prod.send("demo@lucaplan.cl")
  assert.equal(prod.sent.length, 1)
  assert.equal((await prod.verify("demo@lucaplan.cl", "000000")).status, 400)
})

test("en desarrollo sin RESEND_API_KEY el código se imprime en la consola del servidor; en producción sin Resend no se imprime y el envío falla", async (t) => {
  const printed: string[] = []
  for (const m of ["log", "info", "warn", "error"] as const)
    t.mock.method(console, m, (...args: unknown[]) => {
      printed.push(args.map(String).join(" "))
    })
  const transport = t.mock.fn(async () => new Response("{}", { status: 200 }))

  const devNoKey = { apiKey: undefined, from: undefined, env: { NODE_ENV: "development" } }
  await createResendLoginCodeMailer(devNoKey).send("nueva@example.com", "482913")
  assert.ok(printed.some((l) => l.includes("482913") && l.includes("nueva@example.com")))

  // Borde: en desarrollo CON clave se manda por Resend y el código no va a la consola.
  printed.length = 0
  const devKey = { apiKey: "re_test", from: undefined, transport, env: { NODE_ENV: "development" } }
  await createResendLoginCodeMailer(devKey).send("nueva@example.com", "777111")
  assert.equal(transport.mock.callCount(), 1)
  assert.ok(!printed.some((l) => l.includes("777111")))

  // Borde: en producción sin clave el código nunca se imprime.
  printed.length = 0
  const prodNoKey = { apiKey: undefined, from: undefined, env: { NODE_ENV: "production" } }
  await assert.rejects(createResendLoginCodeMailer(prodNoKey).send("nueva@example.com", "555444"))
  assert.ok(!printed.some((l) => l.includes("555444")))
})
