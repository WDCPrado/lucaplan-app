// Sincroniza un Link de Fintoc: institución → banco, cuentas y movimientos. Idempotente (upsert por
// id externo). Saldo del proveedor (autoritativo). Tras importar, categoriza con IA los movimientos
// que queden sin categoría (best-effort; no ajusta el saldo local). Reutilizado por conectar,
// refrescar y webhook.
import type {
  AccountRepository,
  BankRepository,
  CategoryRepository,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts"
import type { BankAggregationProvider } from "../../domain/finance/bank-aggregation.port.ts"
import type { CategorizationProvider } from "../../domain/finance/categorization.port.ts"
import { mapProviderAccount, mapProviderMovement } from "./fintoc-map.ts"
import { categorizeMovements } from "./categorize-movements-use-case.ts"

export type SyncDeps = {
  banks: BankRepository
  accounts: AccountRepository
  transactions: TransactionRepository
  provider: BankAggregationProvider
  // Opcionales: si faltan, se importa sin categorizar (degradación elegante).
  categories?: CategoryRepository
  categorization?: CategorizationProvider
}

export type SyncLinkInput = {
  linkId: string // link_...
  linkToken: string // token secreto del Link
  institutionName: string
}

// Primera conexión: importa los últimos N meses (mes actual + los N-1 previos), no todo el histórico.
const INITIAL_MONTHS = 3

// Primer día del mes de inicio de la ventana inicial (UTC): (INITIAL_MONTHS-1) meses atrás.
function initialWindowStartUTC(): Date {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (INITIAL_MONTHS - 1), 1)
  )
}

export async function syncLink(
  deps: SyncDeps,
  userId: string,
  input: SyncLinkInput
): Promise<{ bankId: string; accounts: number; movements: number }> {
  // Sync incremental: si el banco ya existía, solo trae lo creado/actualizado desde el último sync.
  const existing = await deps.banks.findByExternalLinkId(input.linkId)
  const updatedSince = existing?.lastSyncedAt ?? undefined
  // Primera conexión (aún sin sync): importar SOLO los últimos meses (ventana inicial), no todo el
  // histórico. Lo anterior no se trae; lo nuevo llega después por el sync incremental.
  const sinceDate = existing?.lastSyncedAt ? undefined : initialWindowStartUTC()

  // listAccounts valida el linkToken (falla con BankConnectionError si es inválido).
  const providerAccounts = await deps.provider.listAccounts(input.linkToken)
  const bank = await deps.banks.upsertConnected({
    userId,
    name: input.institutionName || "Banco",
    externalLinkId: input.linkId,
    linkToken: input.linkToken,
  })

  // Cuentas en paralelo: aparecen juntas rápido (mejor UX); los movimientos de cada una en lotes.
  const results = await Promise.all(
    providerAccounts.map(async (pa) => {
      const mapped = mapProviderAccount(pa)
      if (!mapped) return { accounts: 0, movements: 0 } // moneda no soportada → se omite
      try {
        const account = await deps.accounts.upsertConnected({
          userId,
          bankId: bank.id,
          externalId: pa.externalId,
          name: pa.name,
          ...mapped,
        })
        // Primera conexión: `since` acota la descarga al mes actual (server-side, por post_date).
        // Incremental: `updatedSince` trae solo lo cambiado. El filtro cliente por transaction_date
        // deja exacto el "mes actual" (quita lo de meses previos que postearon este mes).
        const raw = await deps.provider.listMovements(
          input.linkToken,
          pa.externalId,
          { confirmedOnly: false, updatedSince, since: sinceDate }
        )
        const toImport = raw
          .map(mapProviderMovement)
          .filter((m): m is NonNullable<typeof m> => m !== null)
          .filter((m) => !sinceDate || m.date >= sinceDate)
        const imported = await deps.transactions.importMovements(
          userId,
          account.id,
          toImport
        )
        // Categorización con IA best-effort: solo los recién importados sin categoría; no rompe el sync.
        if (deps.categorization && deps.categories) {
          try {
            await categorizeMovements(
              {
                transactions: deps.transactions,
                categories: deps.categories,
                categorization: deps.categorization,
              },
              userId,
              imported
            )
          } catch (e) {
            console.error("[sync] categorización con IA falló:", e)
          }
        }
        return { accounts: 1, movements: toImport.length }
      } catch (e) {
        // Carrera benigna: el banco/cuenta se borró mientras sincronizábamos en background
        // (desconectar concurrente) → la FK falla (P2003). El sync quedó obsoleto: se omite.
        if ((e as { code?: string })?.code === "P2003")
          return { accounts: 0, movements: 0 }
        throw e
      }
    })
  )
  return {
    bankId: bank.id,
    accounts: results.reduce((s, r) => s + r.accounts, 0),
    movements: results.reduce((s, r) => s + r.movements, 0),
  }
}
