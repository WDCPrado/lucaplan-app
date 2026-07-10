// Config de Better Auth (autenticación). Es infraestructura: implementa el authN.
// La autorización (roles → permisos) vive en el dominio (can()/authorize()); aquí el
// admin plugin solo aporta los campos role/banned al schema y reconoce ADMIN como rol
// administrador. Rol por defecto al registrarse: USER.
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { prisma } from "../database/prisma/client.ts";

export const auth = betterAuth({
  appName: "LucaPlan",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // LANZAMIENTO: quitar `disableSignUp: true` para abrir el registro (ver docs/pre-launch-lock.md)
  emailAndPassword: { enabled: true, disableSignUp: true },
  plugins: [admin({ defaultRole: "USER", adminRoles: ["ADMIN"] })],
});

export type Session = typeof auth.$Infer.Session;
