import { SetupFlow } from "@/components/setup/setup-flow"

export const metadata = { title: "Instalación · Luca Plan" }

// Instalación inicial: la ve quien levanta un servidor sin cuentas. El estado (¿hace falta?, ¿ya
// validó el código?) se pide en el cliente; si ya está instalado, el flujo manda a /login.
export default function SetupPage() {
  return (
    <SetupFlow
      // La misma que arma outlook-oauth.ts: la que hay que registrar en Microsoft Entra.
      outlookRedirectUri={
        process.env.OUTLOOK_REDIRECT_URI ||
        `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/api/email-connection/callback`
      }
    />
  )
}
