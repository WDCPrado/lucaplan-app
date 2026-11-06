import type { LoginCodeMailer } from "../../../domain/login-code.ts"
import { LOGIN_CODE_MINUTES } from "../../../domain/login-code.ts"
import { integrationDeps } from "../../database/prisma/integration-deps.ts"
import { resolveIntegration } from "../../../application/integration-use-cases/resolve-integration-use-case.ts"

type LocalEnv = { NODE_ENV?: string; RAILWAY_ENVIRONMENT_NAME?: string }
type ResendCredentials = { apiKey?: string | null; from?: string | null }

// Solo en local (development exacto, fuera de Railway) y sin clave de Resend.
const toConsole = (env: LocalEnv, apiKey?: string | null) =>
  !apiKey && env.NODE_ENV === "development" && !env.RAILWAY_ENVIRONMENT_NAME

/**
 * ¿El código va a la consola del servidor en vez de al correo? Sin RESEND_API_KEY en el entorno ni
 * en Ajustes, y solo en local. Lo usa el login para mostrar la pista.
 */
export async function printsLoginCodeLocally(env: LocalEnv = process.env): Promise<boolean> {
  return toConsole(env) && toConsole(env, await resolveIntegration(integrationDeps, "RESEND_API_KEY"))
}

/**
 * HTML local: no requiere crear una plantilla en la cuenta de Resend. `credentials` resuelve la
 * clave y el remitente en cada envío (cambian desde Ajustes sin reiniciar); sin él, `apiKey`/`from`.
 */
export function createResendLoginCodeMailer({
  apiKey,
  from,
  credentials,
  transport = fetch,
  env = process.env,
}: {
  apiKey?: string
  from?: string
  credentials?: () => Promise<ResendCredentials>
  transport?: typeof fetch
  env?: LocalEnv
}): LoginCodeMailer {
  return {
    async send(email, code) {
      if (!/^\d{6}$/.test(code)) throw new Error("Código de acceso inválido.")
      const { apiKey: key, from: sender } = credentials ? await credentials() : { apiKey, from }
      // Producción sin Resend nunca imprime el código: el envío falla.
      if (toConsole(env, key)) {
        console.info(`[login-code] Código de acceso para ${email}: ${code} (sin RESEND_API_KEY, solo en desarrollo)`)
        return
      }
      if (!key) throw new Error("Resend no está configurado.")
      try {
        const response = await transport("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: sender?.trim() || "Luca Plan <no-reply@lucaplan.cl>",
            to: email,
            subject: "Tu código de acceso a Luca Plan",
            text: `Tu código de acceso a Luca Plan es ${code}. Vale ${LOGIN_CODE_MINUTES} minutos y sirve una sola vez. Si no lo solicitaste, ignora este correo.`,
            html: `<div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:auto;padding:32px;color:#172033"><p style="font-weight:600;color:#0b3f9e">Luca Plan</p><h1 style="font-size:24px">Tu código de acceso</h1><p>Escribe este código en Luca Plan. Vale ${LOGIN_CODE_MINUTES} minutos y sirve una sola vez.</p><p style="padding:20px;background:#eff6ff;border-radius:12px;text-align:center;font-size:36px;font-weight:700;letter-spacing:8px;color:#0b3f9e">${code}</p><p>Si no lo solicitaste, ignora este correo: sin el código nadie puede entrar a tu cuenta.</p></div>`,
          }),
        })
        if (!response.ok) throw new Error("Envío rechazado.")
      } catch {
        // Nunca propagar bodies del proveedor, destinatarios ni códigos a logs/HTTP.
        throw new Error("No se pudo enviar el código de acceso.")
      }
    },
  }
}
