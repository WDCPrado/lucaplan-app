import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { prisma } from "@/arch/v1/infrastructure/database/prisma/client"
import {
  prDemoAccount,
  prDemoEmailDomain,
  type DemoLogin,
} from "@/lib/pr-demo"
import { LoginForm } from "./login-form"

export default async function LoginPage() {
  // Chequeo de sesión REAL (no la cookie): si ya hay sesión, a la app. Server-side
  // para evitar el bucle con el proxy.
  const session = await auth.api.getSession({ headers: await headers() })
  if (session) redirect("/dashboard")

  // La variable de Railway es server-only: las cuentas se resuelven aquí y bajan como prop.
  const demo = prDemoAccount()
  let login: DemoLogin | null = null
  if (demo) {
    // Se leen de la BASE, no del directorio de escenas: los .ts de scripts/ no existen en el
    // runtime de Next. El orden de creación es el de siembra —la base primero, después las escenas
    // en orden alfabético— que es el mismo en que conviene ofrecerlas.
    const usuarios = await prisma.user.findMany({
      where: { email: { endsWith: prDemoEmailDomain(demo.email) } },
      select: { email: true, name: true },
      orderBy: { createdAt: "asc" },
    })
    login = {
      env: demo.env,
      password: demo.password,
      cuentas: usuarios.map(({ email, name }) => ({ email, titulo: name })),
    }
  }

  return <LoginForm demo={login} />
}
