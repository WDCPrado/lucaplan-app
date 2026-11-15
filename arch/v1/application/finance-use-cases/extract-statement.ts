// extraerCartola (WDC-183): lee la cartola subida (PDF, XLS, XLSX o CSV) con el lector inyectado y
// valida lo que devuelve contra el documento de la conciliación. El archivo no se guarda: vive solo
// en esta petición. Sin key, error de red o salida inválida → «No se pudo leer la cartola» (no se
// degrada en silencio a una propuesta vacía).
import {
  NotOwnerError,
  type AccountRepository,
} from "../../domain/finance/finance.domain.ts"
import { EmailSetupStateError } from "../../domain/finance/email-connection.domain.ts"
import type { StatementReader } from "../../domain/finance/bank-reconciliation.domain.ts"
import {
  statementDocumentSchema,
  type StatementDocument,
} from "../../../../lib/schemas/bank-reconciliation.ts"

export const STATEMENT_MAX_BYTES = 10 * 1024 * 1024
const EXTENSIONS = ["pdf", "xls", "xlsx", "csv"]

export async function extraerCartola(
  deps: {
    accounts: Pick<AccountRepository, "findById">
    statementReader: StatementReader
  },
  userId: string,
  accountId: string,
  file: { name: string; type: string; data: Uint8Array }
): Promise<StatementDocument> {
  // Antes de mandar nada afuera: la cuenta es del usuario.
  const account = await deps.accounts.findById(accountId)
  if (!account || account.userId !== userId) throw new NotOwnerError()
  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (!EXTENSIONS.includes(extension) || !file.data.byteLength)
    throw new EmailSetupStateError("La cartola debe ser un PDF, XLS, XLSX o CSV")
  if (file.data.byteLength > STATEMENT_MAX_BYTES)
    throw new EmailSetupStateError("La cartola no puede pasar de 10 MB")
  let raw: unknown
  try {
    raw = await deps.statementReader.read(file, {
      accountType: account.accountType,
    })
  } catch (error) {
    // Solo el motivo técnico (status, timeout): nunca el contenido de la cartola.
    console.warn("extraerCartola:", (error as Error).message)
    throw new EmailSetupStateError("No se pudo leer la cartola")
  }
  const parsed = statementDocumentSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn("extraerCartola: salida inválida", parsed.error.issues.length)
    throw new EmailSetupStateError("No se pudo leer la cartola")
  }
  return parsed.data
}
