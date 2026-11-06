import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { isSignupOpen } from "@/arch/v1/infrastructure/auth/login-code"
import { printsLoginCodeLocally } from "@/arch/v1/infrastructure/email/resend/login-code.mailer"
import { LoginForm } from "./login-form"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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
      codeInConsole={printsLoginCodeLocally()}
    />
  )
}
