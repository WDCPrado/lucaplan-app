import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { userRepository } from "@/arch/v1/infrastructure/auth/user.repository"
import {
  prDemoAccount,
  prDemoEmailDomain,
  type DemoLogin,
} from "@/lib/pr-demo"
import { LoginForm } from "./login-form"

// Tope de cuentas a ofrecer. El seed crea una por escena, así que en la práctica son unas pocas;
// el tope es para que la página no crezca sin límite si algún día son muchas más.
const MAX_CUENTAS = 25

async function demoLogin(): Promise<DemoLogin | null> {
  const demo = prDemoAccount()
  if (!demo) return null
  const dominio = prDemoEmailDomain(demo.email)
  if (!dominio) {
    console.warn(
      `[login] SEED_PR_EMAIL="${demo.email}" no tiene un dominio usable: no se ofrece ninguna cuenta.`
    )
    return null
  }
  // Se leen de la BASE, no del directorio de escenas: los .ts de scripts/ no existen en el runtime
  // de Next. El orden de creación es el de siembra —la base primero, después las escenas en orden
  // alfabético— que es el mismo en que conviene ofrecerlas.
  const usuarios = await userRepository.listByEmailDomain(dominio, MAX_CUENTAS)
  return {
    env: demo.env,
    password: demo.password,
    cuentas: usuarios.map(({ email, name }) => ({ email, titulo: name })),
  }
}

export default async function LoginPage() {
  // Chequeo de sesión REAL (no la cookie): si ya hay sesión, a la app. Server-side
  // para evitar el bucle con el proxy.
  const session = await auth.api.getSession({ headers: await headers() })
  if (session) redirect("/dashboard")

  // Las variables de Railway son server-only: las cuentas se resuelven aquí y bajan como prop.
  return <LoginForm demo={await demoLogin()} />
}
