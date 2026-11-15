import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { extraerCartola } from "@/arch/v1/application/finance-use-cases/extract-statement"
import { proponerConciliacion } from "@/arch/v1/application/finance-use-cases/propose-reconciliation"
import { openaiStatementReader } from "@/arch/v1/infrastructure/http/ai/openai-statement-reader.provider"
import { EmailSetupStateError } from "@/arch/v1/domain/finance/email-connection.domain"

// Sube la cartola (multipart, campo `file`), la lee y devuelve la propuesta de conciliación. No
// escribe ni guarda el archivo: se aplica después con POST /api/accounts/[id]/reconciliation.
// ponytail: formData lee el cuerpo entero antes de medir el archivo; el tope de 10 MB se valida
// después. Limitar el cuerpo en el proxy si llega a importar.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
    const file = (await req.formData().catch(() => null))?.get("file")
    if (!(file instanceof File))
      throw new EmailSetupStateError("Sube la cartola en el campo file")
    const document = await extraerCartola(
      { ...financeDeps, statementReader: openaiStatementReader },
      userId,
      id,
      { name: file.name, type: file.type, data: new Uint8Array(await file.arrayBuffer()) }
    )
    return proponerConciliacion(financeDeps, userId, id, document)
  })
}
