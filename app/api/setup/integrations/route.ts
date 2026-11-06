// Claves de terceros desde el asistente de /setup: con la cookie verificada, mismas reglas que
// PUT /api/integrations. 401 sin cookie · 404 ya instalado.
import { cookies } from "next/headers"
import { respond } from "@/arch/v1/presentation/finance/finance-http"
import { updateSetupIntegrations } from "@/arch/v1/application/setup-use-cases/setup-use-cases"
import { SETUP_COOKIE } from "@/arch/v1/domain/setup/setup.domain"
import { setupDeps } from "@/arch/v1/infrastructure/database/prisma/setup-deps"

export async function PUT(req: Request) {
  const token = (await cookies()).get(SETUP_COOKIE)?.value ?? null
  const body = await req.json().catch(() => null)
  return respond(() => updateSetupIntegrations(setupDeps, token, body))
}
