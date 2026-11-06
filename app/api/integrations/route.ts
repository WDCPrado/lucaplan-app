// Claves de terceros de la instalación (Ajustes → Integraciones). Solo ADMIN: el caso de uso
// autoriza con el rol de la sesión (403 a los demás). Contrato: lib/integration-settings-schemas.ts.
import { withActor } from "@/arch/v1/presentation/finance/finance-http"
import { getIntegrations } from "@/arch/v1/application/integration-use-cases/get-integrations-use-case"
import { updateIntegrations } from "@/arch/v1/application/integration-use-cases/update-integrations-use-case"
import { integrationDeps } from "@/arch/v1/infrastructure/database/prisma/integration-deps"

export async function GET(req: Request) {
  return withActor(req, (actor) => getIntegrations(integrationDeps, actor))
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null)
  return withActor(req, (actor) => updateIntegrations(integrationDeps, actor, body))
}
