// Solo runtime Node: lo importa instrumentation.ts dentro del `if` de NEXT_RUNTIME, para que el
// bundle edge no arrastre Prisma ni node:*.
import { ensureSetupCode } from "./arch/v1/application/setup-use-cases/setup-use-cases.ts"
import { setupDeps } from "./arch/v1/infrastructure/database/prisma/setup-deps.ts"

export async function checkSetup() {
  try {
    await ensureSetupCode(setupDeps)
  } catch (e) {
    console.error("[setup] No se pudo revisar la instalación:", (e as Error).message)
  }
}
