import type { LoginCodeMailer } from "../../../domain/login-code.ts"
import { LOGIN_CODE_MINUTES } from "../../../domain/login-code.ts"

/** HTML local: no requiere crear una plantilla en la cuenta de Resend. */
export function createResendLoginCodeMailer({
  apiKey,
  from,
  transport = fetch,
}: {
  apiKey?: string
  from?: string
  transport?: typeof fetch
}): LoginCodeMailer {
  return {
    async send(email, code) {
      if (!apiKey) throw new Error("Resend no está configurado.")
      if (!/^\d{6}$/.test(code)) throw new Error("Código de acceso inválido.")
      try {
        const response = await transport("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: from?.trim() || "Luca Plan <no-reply@lucaplan.cl>",
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
