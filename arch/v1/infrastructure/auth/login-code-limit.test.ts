// Tope de códigos por destinatario (WDC-181): 5 por hora, sin cambiar la respuesta.
// Corre con: node --test arch/v1/infrastructure/auth/login-code-limit.test.ts
import assert from "node:assert/strict"
import test from "node:test"
import { betterAuth } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import { createLoginCodePlugin, isSignupOpen } from "./login-code.ts"

test("un mismo correo recibe a lo más 5 códigos por hora; el sexto pedido responde igual pero no envía", async () => {
  const now = new Date()
  const sent: string[] = []
  const auth = betterAuth({
    baseURL: "http://localhost:3181",
    secret: "wdc181-test-secret-only-not-a-real-secret-123456",
    database: memoryAdapter({
      user: [{ id: "u1", name: "Persona", email: "persona@example.com", emailVerified: true, createdAt: now, updatedAt: now }],
      session: [],
      account: [],
      verification: [],
    }),
    emailAndPassword: { enabled: false },
    plugins: [createLoginCodePlugin({ async send(email) { sent.push(email) } }, { NODE_ENV: "production" })],
    rateLimit: { enabled: false },
    logger: { disabled: true },
  })
  const send = async (email: string) => {
    const res = await auth.handler(
      new Request("http://localhost:3181/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3181" },
        body: JSON.stringify({ email, type: "sign-in" }),
      })
    )
    await new Promise((r) => setImmediate(r))
    return res
  }
  const bodies = []
  for (let i = 0; i < 6; i++) {
    const res = await send("persona@example.com")
    assert.equal(res.status, 200)
    bodies.push(await res.json())
  }
  assert.equal(sent.length, 5)
  assert.deepEqual(bodies[5], bodies[0])
})

test("registro abierto: SIGNUP_OPEN=true exacto, o development fuera de Railway", () => {
  assert.equal(isSignupOpen({ SIGNUP_OPEN: "true", NODE_ENV: "production" }), true)
  assert.equal(isSignupOpen({ NODE_ENV: "development" }), true)
  assert.equal(isSignupOpen({ NODE_ENV: "development", RAILWAY_ENVIRONMENT_NAME: "lucaplan-pr-12" }), false)
  assert.equal(isSignupOpen({ NODE_ENV: "production", SIGNUP_OPEN: "TRUE" }), false)
})
