// Estado de la instalación inicial. Público; 404 en cuanto existe una cuenta. Trae el estado de las
// claves solo con la cookie del asistente verificada. Contrato: lib/integration-settings-schemas.ts.
import { cookies } from "next/headers"
import { respond } from "@/arch/v1/presentation/finance/finance-http"
import { ensureSetupCode, getSetupStatus } from "@/arch/v1/application/setup-use-cases/setup-use-cases"
import { SETUP_COOKIE } from "@/arch/v1/domain/setup/setup.domain"
import { setupDeps } from "@/arch/v1/infrastructure/database/prisma/setup-deps"

export async function GET() {
  const token = (await cookies()).get(SETUP_COOKIE)?.value ?? null
  return respond(async () => {
    await ensureSetupCode(setupDeps) // por si instrumentation no alcanzó a generarlo
    return getSetupStatus(setupDeps, token)
  })
}
