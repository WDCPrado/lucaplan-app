// Dispara la categorización con IA de los movimientos que quedaron sin categoría, sin importar de
// qué mes sean. Hasta ahora esa pasada solo ocurría dentro del flujo de correo y con el error
// tragado: si fallaba —o la IA no estaba configurada— no había forma de reintentarla y los
// movimientos quedaban sin categoría hasta clasificarlos a mano.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { categorizePendingMovements } from "@/arch/v1/infrastructure/database/prisma/categorize-pending.infrastructure"
import { openaiConfigured } from "@/arch/v1/infrastructure/http/ai/openai-config"
import { integrationDeps } from "@/arch/v1/infrastructure/database/prisma/integration-deps"

export async function POST(req: Request) {
  return withUser(req, async (userId) => {
    // Sin API key el proveedor devuelve vacío en silencio, que se ve igual que "no encontró
    // categoría para ninguno". Se distingue acá para que la UI pueda decir lo que pasa.
    if (!(await openaiConfigured(integrationDeps))) return { configured: false, assigned: 0 }
    return {
      configured: true,
      // ponytail: hasta 10 páginas de 500 por pedido; si quedan más, se vuelve a pedir.
      assigned: await categorizePendingMovements(userId, 10),
    }
  })
}
