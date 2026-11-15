import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  extraerCartola,
  STATEMENT_MAX_BYTES,
} from "@/arch/v1/application/finance-use-cases/extract-statement"
import { proponerConciliacion } from "@/arch/v1/application/finance-use-cases/propose-reconciliation"
import { openaiStatementReader } from "@/arch/v1/infrastructure/http/ai/openai-statement-reader.provider"
import { StatementReadError } from "@/arch/v1/domain/finance/bank-reconciliation.domain"

// Margen del multipart (límites y encabezados) sobre el tope del archivo.
const MAX_BODY = STATEMENT_MAX_BYTES + 64 * 1024

// Sube la cartola (multipart, campo `file`), la lee y devuelve la propuesta de conciliación. No
// escribe ni guarda el archivo: se aplica después con POST /api/accounts/[id]/reconciliation.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  // Antes de leer el cuerpo: sin largo declarado o sobre el tope no se recibe.
  const length = Number(req.headers.get("content-length"))
  if (!length || length > MAX_BODY)
    return Response.json(
      { error: "La cartola no puede pasar de 10 MB" },
      { status: 413 }
    )
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
    const file = (await req.formData().catch(() => null))?.get("file")
    if (!(file instanceof File))
      throw new StatementReadError("Sube la cartola en el campo file")
    const document = await extraerCartola(
      { ...financeDeps, statementReader: openaiStatementReader },
      userId,
      id,
      { name: file.name, type: file.type, data: new Uint8Array(await file.arrayBuffer()) }
    )
    return proponerConciliacion(financeDeps, userId, id, document)
  })
}
