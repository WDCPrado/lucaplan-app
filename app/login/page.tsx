import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { isSetupVerified } from "@/arch/v1/application/setup-use-cases/setup-use-cases"
import { SETUP_COOKIE } from "@/arch/v1/domain/setup/setup.domain"
import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { isSignupOpen } from "@/arch/v1/infrastructure/auth/login-code"
import {
  isInstallationEmpty,
  setupDeps,
} from "@/arch/v1/infrastructure/database/prisma/setup-deps"
import { printsLoginCodeLocally } from "@/arch/v1/infrastructure/email/resend/login-code.mailer"
import { LoginForm } from "./login-form"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Sin ninguna cuenta, lo primero es la instalación inicial; salvo que este navegador ya validó
  // el código de /setup y viene a crear la primera cuenta (mismo chequeo que auth.ts). Si la base
  // no responde, se trata como «no vacía» y se muestra el login.
  const empty = await isInstallationEmpty().catch(() => false)
  const setupToken = (await cookies()).get(SETUP_COOKIE)?.value ?? null
  if (empty && !isSetupVerified(setupDeps, setupToken)) redirect("/setup")
  const query = await searchParams
  const continuingOAuth =
    typeof query.sig === "string" && query.ba_param !== undefined
  // Chequeo de sesión REAL (no la cookie): si ya hay sesión, a la app. Server-side
  // para evitar el bucle con el proxy.
  const session = await auth.api.getSession({ headers: await headers() })
  if (session && !continuingOAuth) redirect("/dashboard")

  return (
    <LoginForm
      signupOpen={isSignupOpen()}
      codeInConsole={await printsLoginCodeLocally()}
    />
  )
}
