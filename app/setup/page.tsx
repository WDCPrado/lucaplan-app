import { redirect } from "next/navigation"
import { connection } from "next/server"
import { isInstallationEmpty } from "@/arch/v1/infrastructure/database/prisma/setup-deps"
import { SetupFlow } from "@/components/setup/setup-flow"

export const metadata = { title: "Instalación · Luca Plan" }

// Instalación inicial: la ve quien levanta un servidor sin cuentas. El estado (¿hace falta?, ¿ya
// validó el código?) se pide en el cliente. Con cuentas ya no hay nada que instalar: a /login.
export default async function SetupPage() {
  await connection() // se decide en cada pedido, no en el build
  if (!(await isInstallationEmpty())) redirect("/login")
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
