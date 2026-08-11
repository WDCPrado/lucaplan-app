// Config de Better Auth (autenticación). Es infraestructura: implementa el authN.
// La autorización (roles → permisos) vive en el dominio (can()/authorize()); aquí el
// admin plugin solo aporta los campos role/banned al schema y reconoce ADMIN como rol
// administrador. Rol por defecto al registrarse: USER.
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { admin } from "better-auth/plugins"
import { prisma } from "../database/prisma/client.ts"
import { categoryRepository } from "../database/prisma/finance.infrastructure.ts"
import { seedDefaultCategories } from "../../application/finance-use-cases/seed-default-categories-use-case.ts"
import { prDemoAccount } from "../../../../lib/pr-demo.ts"
import { devAnyPasswordEnabled } from "./dev-any-password.ts"

// Atajo de desarrollo: cualquier contraseña entra si el correo existe. Se avisa fuerte en consola
// porque es un login abierto, aunque solo pueda existir en local (ver dev-any-password.ts).
const anyPassword = devAnyPasswordEnabled()
if (anyPassword) {
  console.warn(
    "[auth] DEV_ANY_PASSWORD activo: cualquier contraseña entra si el correo existe. Solo desarrollo local."
  )
}

export const auth = betterAuth({
  appName: "Luca Plan",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // Entornos efímeros de PR (Railway): el dominio es dinámico (…-pr-N.up.railway.app), así que
  // Better Auth rechazaría el login por origin desconocido. Se confía el dominio del servicio y,
  // como red, cualquier https de Railway — SOLO en PR (datos seed); producción no agrega nada.
  trustedOrigins: prDemoAccount()
    ? [
        ...(process.env.RAILWAY_PUBLIC_DOMAIN
          ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`]
          : []),
        "https://*.up.railway.app",
      ]
    : [],
  // Landing-only (vitrina open source): el registro se cierra también en el endpoint,
  // no solo en la UI. Solo entran cuentas existentes.
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.NEXT_PUBLIC_LANDING_ONLY === "true",
    // ponytail: reset por consola en local; cambiar por envío de correo cuando toque.
    sendResetPassword: async ({ url }) => {
      console.log("[reset-password]", url)
    },
    // El hash real se sigue guardando y usando; en local solo se salta la comparación.
    ...(anyPassword ? { password: { verify: async () => true } } : {}),
  },
  plugins: [admin({ defaultRole: "USER", adminRoles: ["ADMIN"] })],
  // Cuenta nueva → categorías por defecto, si no el usuario aterriza sin nada contra qué
  // categorizar (ni él en el triage, ni la IA). Auth actúa aquí como adaptador conductor: recibe
  // un evento externo y llama a un use-case, igual que el wiring de push (push-deps.ts). Un fallo
  // NO puede tumbar el registro: se loguea y la cuenta queda creada.
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            await seedDefaultCategories(
              { categories: categoryRepository },
              user.id
            )
          } catch (e) {
            console.error("[seed-categories]", (e as Error).message)
          }
        },
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session
