import assert from "node:assert/strict"
import test from "node:test"
import { betterAuth } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import { createLoginCodePlugin } from "./login-code.ts"
import { withPluginAuthRequest } from "./plugin-request.ts"

// Importa la composición REAL con configuración ficticia; no abre .env ni conecta a PostgreSQL.
process.env.BETTER_AUTH_URL = "http://localhost:3154"
process.env.BETTER_AUTH_SECRET =
  "wdc154-test-only-secret-not-production-123456789"
process.env.DATABASE_URL = "postgresql://dummy:dummy@127.0.0.1:55454/dummy"
process.env.RESEND_API_KEY = "dummy-not-used"
process.env.RESEND_FROM = "Luca Test <test@example.com>"
process.env.RAILWAY_ENVIRONMENT_NAME = ""
const { auth: configured } = await import("./auth.ts")

test("OTP conserva continuación OAuth firmada y rechaza query alterada", async () => {
  const now = new Date()
  const db: Record<string, Record<string, unknown>[]> = {
    user: [
      {
        id: "oauth-user",
        name: "Prueba",
        email: "oauth@example.com",
        emailVerified: true,
        role: "USER",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    session: [],
    account: [],
    verification: [],
    jwks: [],
    oAuthClient: [],
    oAuthConsent: [],
    oAuthAccessToken: [],
    oAuthRefreshToken: [],
  }
  let code = ""
  const auth = betterAuth({
    ...configured.options,
    database: memoryAdapter(db),
    plugins: configured.options.plugins!.map((plugin) =>
      plugin.id === "email-otp"
        ? createLoginCodePlugin({
            async send(_email, otp) {
              code = otp
            },
          })
        : plugin
    ),
    rateLimit: { enabled: false },
    logger: { disabled: true },
  })
  const request = (path: string, body?: unknown) =>
    withPluginAuthRequest(() =>
      auth.handler(
        new Request(`http://localhost:3154/api/auth${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost:3154",
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
      )
    )
  const registration = await request("/oauth2/register", {
    client_name: "Cliente de prueba",
    redirect_uris: ["https://client.example.com/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: "openid finance:read",
  })
  assert.equal(registration.status, 200)
  const { client_id } = await registration.json()
  const query = new URLSearchParams({
    client_id,
    redirect_uri: "https://client.example.com/callback",
    response_type: "code",
    scope: "openid finance:read",
    state: "test-state",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
  })
  const authorization = await request(`/oauth2/authorize?${query}`)
  assert.equal(authorization.status, 302)
  const login = new URL(
    authorization.headers.get("location")!,
    "http://localhost:3154"
  )
  assert.equal(login.pathname, "/login")
  assert.ok(login.searchParams.has("sig"))
  const oauth_query = login.searchParams.toString()
  const altered = new URLSearchParams(oauth_query)
  altered.set("redirect_uri", "https://attacker.example.com")
  const send = { email: "oauth@example.com", type: "sign-in" }
  assert.equal(
    (
      await request("/email-otp/send-verification-otp", {
        ...send,
        oauth_query: altered.toString(),
      })
    ).status,
    400
  )
  assert.equal(code, "")
  assert.equal(
    (
      await request("/email-otp/send-verification-otp", {
        ...send,
        oauth_query,
      })
    ).status,
    200
  )
  const invalid = await request("/sign-in/email-otp", {
    email: send.email,
    otp: code,
    oauth_query: altered.toString(),
  })
  assert.equal(invalid.status, 400)
  assert.equal(db.session.length, 0)
  const signedIn = await request("/sign-in/email-otp", {
    email: send.email,
    otp: code,
    oauth_query,
  })
  assert.equal(signedIn.status, 200)
  const result = await signedIn.json()
  assert.equal(result.redirect, true)
  const continuation = new URL(result.url, "http://localhost:3154")
  assert.equal(continuation.origin, "http://localhost:3154")
  assert.equal(continuation.pathname, "/plugin/consent")
  assert.equal(continuation.searchParams.get("client_id"), client_id)
  assert.equal(db.session[0].userId, "oauth-user")
})
