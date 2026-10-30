// Preferencias de apariencia del usuario de la sesión (nivel de vidrio, tema). Siempre las del
// actor autenticado: la ruta no recibe userId. Un patch inválido responde 422 (ZodError en withUser).
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { updateUserSettings } from "@/arch/v1/application/user-use-cases/user-settings-use-cases"
import { userSettingsDeps } from "@/arch/v1/infrastructure/database/prisma/user-settings.infrastructure"

export async function PATCH(req: Request) {
  return withUser(req, async (userId) => {
    const body = await req.json().catch(() => null)
    return updateUserSettings(userSettingsDeps, userId, body)
  })
}
