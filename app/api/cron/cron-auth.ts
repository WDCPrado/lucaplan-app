import { timingSafeEqual } from "node:crypto"

// Los crons no tienen sesión de usuario: se autentican con `CRON_SECRET` como Bearer. Sin el
// secreto en el entorno nadie pasa.
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  const supplied =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
  if (!secret || supplied.length !== secret.length) return false
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
}
