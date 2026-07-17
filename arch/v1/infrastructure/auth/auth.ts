// Config de Better Auth (autenticación). Es infraestructura: implementa el authN.
// La autorización (roles → permisos) vive en el dominio (can()/authorize()); aquí el
// admin plugin solo aporta los campos role/banned al schema y reconoce ADMIN como rol
// administrador. Rol por defecto al registrarse: USER.
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { admin } from "better-auth/plugins"
import { prisma } from "../database/prisma/client.ts"

export const auth = betterAuth({
  appName: "Luca Plan",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // Landing-only (vitrina open source): el registro se cierra también en el endpoint,
  // no solo en la UI. Solo entran cuentas existentes.
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.NEXT_PUBLIC_LANDING_ONLY === "true",
    // ponytail: reset por consola en local; cambiar por envío de correo cuando toque.
    sendResetPassword: async ({ url }) => {
      console.log("[reset-password]", url)
    },
  },
  plugins: [admin({ defaultRole: "USER", adminRoles: ["ADMIN"] })],
})

export type Session = typeof auth.$Infer.Session
