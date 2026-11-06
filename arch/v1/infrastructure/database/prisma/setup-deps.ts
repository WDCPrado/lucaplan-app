// Wiring de la instalación inicial (/setup). El estado (código, sesiones del asistente, intentos)
// es UNO por proceso y cuelga de globalThis: instrumentation.ts, las rutas y auth.ts pueden cargar
// este módulo en instancias distintas y tienen que ver el mismo código.
import { createSetupState, type SetupDeps, type SetupState } from "../../../domain/setup/setup.domain.ts"
import { prisma } from "./client.ts"
import { integrationDeps } from "./integration-deps.ts"

/** ¿La base no tiene ninguna cuenta? Lo usan / y /login para mandar a /setup. */
export async function isInstallationEmpty(): Promise<boolean> {
  return (await prisma.user.findFirst({ select: { id: true } })) === null
}

const g = globalThis as unknown as { lucaplanSetupState?: SetupState }

export const setupDeps: SetupDeps = {
  accounts: { hasAccounts: async () => !(await isInstallationEmpty()) },
  state: (g.lucaplanSetupState ??= createSetupState()),
  integrations: integrationDeps,
  env: process.env,
  now: () => new Date(),
}
