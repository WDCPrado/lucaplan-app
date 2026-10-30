import { emailOTP } from "better-auth/plugins"
import { APIError } from "better-auth/api"
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

export function createLoginCodePlugin(mailer: LoginCodeMailer) {
  return emailOTP({
    disableSignUp: true,
    otpLength: 6,
    expiresIn: LOGIN_CODE_MINUTES * 60,
    allowedAttempts: 3,
    storeOTP: "hashed",
    resendStrategy: "rotate",
    rateLimit: { window: 60, max: 3 },
    sendVerificationOTP: async ({ email, otp, type }) => {
      if (type !== "sign-in") return
      // Servidor Node persistente: enviar fuera de la respuesta evita revelar cuentas por latencia.
      // La respuesta es igual si el correo no existe. Solo se registra un fallo genérico.
      void mailer.send(email, otp).catch(() => {
        console.error("[login-code] No se pudo enviar el correo de acceso.")
      })
    },
  })
}
