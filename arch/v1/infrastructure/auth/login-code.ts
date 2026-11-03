import { emailOTP } from "better-auth/plugins"
import { APIError } from "better-auth/api"
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

export function createLoginCodePlugin(
  mailer: LoginCodeMailer,
  env: Parameters<typeof devLoginCode>[0] = process.env
) {
  const fixed = devLoginCode(env)
  // El email llega en minúsculas (better-auth lo normaliza antes de llamar a `generateOTP`).
  const demoEmail = (isPrEnvironment(env.RAILWAY_ENVIRONMENT_NAME) && process.env.SEED_PR_EMAIL) || DEMO_EMAIL
  const isFixed = (email: string) => fixed !== null && email === demoEmail.toLowerCase()
  return emailOTP({
    // `undefined` hace que better-auth use su generador aleatorio (`generateOTP(...) || default`).
    generateOTP: ({ email }) => (isFixed(email) ? fixed! : undefined),
    disableSignUp: true,
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
}
