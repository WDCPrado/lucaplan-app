// extraerCartola (WDC-183): lee la cartola subida (PDF, XLS, XLSX o CSV) con el lector inyectado y
// valida lo que devuelve contra el documento de la conciliación. El archivo no se guarda: vive solo
// en esta petición. Sin key, error de red o salida inválida → «No se pudo leer la cartola» (no se
// degrada en silencio a una propuesta vacía). Una lectura a la vez por usuario.
import { withLock, LockBusyError } from "../../../shared/mutex.ts"
import {
  NotOwnerError,
  type AccountRepository,
  type BalanceBucketRepository,
} from "../../domain/finance/finance.domain.ts"
import {
  StatementReadError,
  type StatementReader,
} from "../../domain/finance/bank-reconciliation.domain.ts"
import {
  statementDocumentSchema,
  type StatementDocument,
} from "../../../../lib/schemas/bank-reconciliation.ts"

export const STATEMENT_MAX_BYTES = 10 * 1024 * 1024
const EXTENSIONS = ["pdf", "xls", "xlsx", "csv"]

export async function extraerCartola(
  deps: {
    accounts: Pick<AccountRepository, "findById">
    balanceBuckets: Pick<BalanceBucketRepository, "listByAccount">
    statementReader: StatementReader
  },
  userId: string,
  accountId: string,
  file: { name: string; type: string; data: Uint8Array },
  now: Date = new Date()
): Promise<StatementDocument> {
  // Antes de mandar nada afuera: la cuenta es del usuario.
  const account = await deps.accounts.findById(accountId)
  if (!account || account.userId !== userId) throw new NotOwnerError()
  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (!EXTENSIONS.includes(extension) || !file.data.byteLength)
    throw new StatementReadError("La cartola debe ser un PDF, XLS, XLSX o CSV")
  if (file.data.byteLength > STATEMENT_MAX_BYTES)
    throw new StatementReadError("La cartola no puede pasar de 10 MB")
  const buckets = (await deps.balanceBuckets.listByAccount(accountId)).map(
    (b) => ({ kind: b.kind, currency: b.currency })
  )
  let raw: unknown
  try {
    raw = await withLock(`statement:${userId}`, () =>
      deps.statementReader.read(file, {
        accountType: account.accountType,
        buckets,
      })
    )
  } catch (error) {
    if (error instanceof LockBusyError)
      throw new LockBusyError("Ya hay una cartola en lectura; espera a que termine")
    // Solo el motivo técnico (status, timeout): nunca el contenido de la cartola.
    console.warn("extraerCartola:", (error as Error).message)
    throw new StatementReadError()
  }
  const parsed = statementDocumentSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn("extraerCartola: salida inválida", parsed.error.issues.length)
    throw new StatementReadError()
  }
  // Un corte en el futuro (la cartola de hoy sin hora queda a las 23:59) se recorta a ahora: el banco
  // no puede haber informado lo que aún no pasa, y la conciliación rechaza un corte futuro.
  const document = parsed.data
  return new Date(document.snapshotAt) > now
    ? { ...document, snapshotAt: now.toISOString() }
    : document
}
