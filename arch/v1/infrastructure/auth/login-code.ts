import { emailOTP } from "better-auth/plugins"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { createRateWindow } from "../../../shared/rate-window.ts"
import { DEMO_EMAIL, isPrEnvironment } from "../../../../lib/pr-demo.ts"
import {
  LOGIN_CODE_MINUTES,
  type LoginCodeMailer,
} from "../../domain/login-code.ts"

export const PASSWORD_DISABLED_PATHS = [
  "/sign-in/email",
  "/sign-up/email",
  "/change-password",
  "/set-password",
  "/request-password-reset",
  "/reset-password",
  "/forget-password",
  "/email-otp/request-password-reset",
  "/forget-password/email-otp",
  "/email-otp/reset-password",
  "/email-otp/check-verification-otp",
  "/email-otp/verify-email",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
]

export function assertLoginCodeRequest(path: string, body: unknown) {
  if (
    path === "/email-otp/send-verification-otp" &&
    (body as { type?: unknown } | undefined)?.type !== "sign-in"
  ) {
    throw new APIError("BAD_REQUEST", {
      message: "Solicitud de acceso inválida.",
    })
  }
}

/**
 * Código fijo `000000` para la cuenta demo, sin depender del correo, en dos lugares: en local
 * (`NODE_ENV === "development"` exacto y ningún entorno de Railway; `next start` solo pone
 * `production` si NODE_ENV viene vacío) y en un entorno efímero de PR de Railway (`…pr-<n>`), que
 * solo tiene datos sembrados. Nunca en producción. Cualquier otra cuenta recibe su código aleatorio
 * por correo. `null` = código aleatorio y por correo, como siempre.
 */
export function devLoginCode(
  env: { NODE_ENV?: string; RAILWAY_ENVIRONMENT_NAME?: string } = process.env
): string | null {
  const local = env.NODE_ENV === "development" && !env.RAILWAY_ENVIRONMENT_NAME
  return local || isPrEnvironment(env.RAILWAY_ENVIRONMENT_NAME) ? "000000" : null
}

/**
 * Registro abierto: un correo nuevo entra con el mismo código y su cuenta se crea al verificarlo.
 * Solo con `SIGNUP_OPEN=true` exacto, o siempre en `NODE_ENV=development`. Cerrado, un correo
 * nuevo recibe la misma respuesta que uno existente, sin código ni cuenta.
 */
export function isSignupOpen(
  env: { NODE_ENV?: string; SIGNUP_OPEN?: string; RAILWAY_ENVIRONMENT_NAME?: string } = process.env
) {
  return (
    env.SIGNUP_OPEN === "true" ||
    (env.NODE_ENV === "development" && !env.RAILWAY_ENVIRONMENT_NAME)
  )
}

// Códigos por destinatario: el rate limit de better-auth es por IP, así que alguien podría llenar
// el buzón de otra persona desde varias IPs. El tope se mira ANTES de que better-auth genere y
// guarde el código (rota el anterior): pasado el tope se responde como un envío exitoso sin rotar
// nada, así el último código que recibió la persona sigue sirviendo.
const CODES_PER_HOUR = 5

export function createLoginCodePlugin(
  mailer: LoginCodeMailer,
  env: Parameters<typeof devLoginCode>[0] & { SIGNUP_OPEN?: string } = process.env
) {
  const fixed = devLoginCode(env)
  // El email llega en minúsculas (better-auth lo normaliza antes de llamar a `generateOTP`).
  const demoEmail = (isPrEnvironment(env.RAILWAY_ENVIRONMENT_NAME) && process.env.SEED_PR_EMAIL) || DEMO_EMAIL
  const isFixed = (email: string) => fixed !== null && email === demoEmail.toLowerCase()
  const perRecipient = createRateWindow(CODES_PER_HOUR, 60 * 60 * 1000)
  const plugin = emailOTP({
    // `undefined` hace que better-auth use su generador aleatorio (`generateOTP(...) || default`).
    generateOTP: ({ email }) => (isFixed(email) ? fixed! : undefined),
    disableSignUp: !isSignupOpen(env),
    otpLength: 6,
    expiresIn: LOGIN_CODE_MINUTES * 60,
    allowedAttempts: 3,
    storeOTP: "hashed",
    resendStrategy: "rotate",
    rateLimit: { window: 60, max: 3 },
    sendVerificationOTP: async ({ email, otp, type }) => {
      if (type !== "sign-in" || isFixed(email)) return
      // Servidor Node persistente: enviar fuera de la respuesta evita revelar cuentas por latencia.
      // La respuesta es igual si el correo no existe. Solo se registra un fallo genérico.
      void mailer.send(email, otp).catch(() => {
        console.error("[login-code] No se pudo enviar el correo de acceso.")
      })
    },
  })
  const limitPerRecipient = {
    matcher: (ctx: { path?: string }) => ctx.path === "/email-otp/send-verification-otp",
    handler: createAuthMiddleware(async (ctx) => {
      const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "").toLowerCase()
      if (!email || isFixed(email)) return
      if (!perRecipient.take(email)) return ctx.json({ success: true })
    }),
  }
  return {
    ...plugin,
    // emailOTP solo trae hooks `after`; el `before` es nuestro.
    hooks: { ...plugin.hooks, before: [limitPerRecipient] },
  }
}
