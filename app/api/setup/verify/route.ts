// Verifica el código de instalación de la consola y deja la cookie del asistente: un token
// aleatorio en memoria del servidor, httpOnly, que vence a la hora. 204 · 401 · 404 · 422 · 429.
import { cookies } from "next/headers"
import { respond } from "@/arch/v1/presentation/finance/finance-http"
import { verifySetupCode } from "@/arch/v1/application/setup-use-cases/setup-use-cases"
import { SETUP_COOKIE, SETUP_SESSION_MS } from "@/arch/v1/domain/setup/setup.domain"
import { setupDeps } from "@/arch/v1/infrastructure/database/prisma/setup-deps"

// La IP que agregó el proxy de confianza: la ÚLTIMA de x-forwarded-for, o `x-real-ip`. Solo se
// leen si hay un proxy que las pise (Railway, o `TRUST_PROXY=true`): sin él, el cliente las inventa
// y cambiar de cabecera en cada intento esquivaría el tope. Sin proxy, una sola cubeta para todos
// (ver docs/self-hosting.md).
const trustProxy = process.env.TRUST_PROXY === "true" || Boolean(process.env.RAILWAY_ENVIRONMENT_NAME)
const ipOf = (req: Request) =>
  (trustProxy &&
    (req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
      req.headers.get("x-real-ip")?.trim())) ||
  "local"

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  let token: string | null = null
  const res = await respond(async () => {
    token = await verifySetupCode(setupDeps, body, ipOf(req))
  })
  if (!token) return res
  const host = new URL(req.url).hostname
  ;(await cookies()).set(SETUP_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: host !== "localhost" && host !== "127.0.0.1",
    path: "/",
    maxAge: SETUP_SESSION_MS / 1000,
  })
  return new Response(null, { status: 204 })
}
