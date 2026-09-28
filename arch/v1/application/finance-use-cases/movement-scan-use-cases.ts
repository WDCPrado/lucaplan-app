// "Registrar del banco" desde una foto de la cartola: leer la imagen (IA) y, tras la confirmación
// del usuario, crear los movimientos elegidos.
//
// Son dos pasos a propósito, igual que el escaneo de saldos: la IA puede leer mal un dígito y
// devolver un monto perfectamente válido, así que leer NO persiste — devuelve candidatos que el
// usuario revisa, edita y destilda. Lo que hace segura esta vía es la deduplicación: los que ya
// están registrados llegan marcados, para no volver a contarlos cuando el correo del banco aparezca.
import {
  AccountNotFoundError,
  NotOwnerError,
  type Account,
  type AccountRepository,
  type BalanceBucketRepository,
  type Direction,
  type TransactionRepository,
} from "../../domain/finance/finance.domain.ts"
import {
  MAX_SCAN_MOVEMENTS,
  MovementScanError,
  toScannedMovements,
  type ExistingMovement,
  type MovementScanReader,
  type ScannedMovement,
} from "../../domain/finance/movement-scan.domain.ts"
import { createTransaction } from "./create-transaction-use-case.ts"
import { periodRange } from "../../../shared/billing-cycle.ts"

type Deps = {
  accounts: AccountRepository
  transactions: TransactionRepository
  balanceBuckets: BalanceBucketRepository
  movementScan: MovementScanReader
}

async function requireAccount(
  deps: Deps,
  userId: string,
  accountId: string
): Promise<Account> {
  const account = await deps.accounts.findById(accountId)
  if (!account) throw new AccountNotFoundError(accountId)
  if (account.userId !== userId) throw new NotOwnerError()
  return account
}

// --- Paso 1: leer la foto (no persiste nada) ---

export async function scanAccountMovements(
  deps: Deps,
  userId: string,
  accountId: string,
  imageDataUrls: string[]
): Promise<{ movements: ScannedMovement[]; skipped: number }> {
  const account = await requireAccount(deps, userId, accountId)
  const readings = await deps.movementScan.read({ imageDataUrls })
  if (readings.length === 0) return { movements: [], skipped: 0 }

  const today = new Date()
  const options = { currency: account.currency, today }
  // Dos pasadas de la MISMA función pura: la primera resuelve las fechas, que son las que dicen qué
  // meses hay que traer para comparar. Consultar un rango fijo (el mes actual y el anterior) sería
  // una query menos y dejaría sin dedupe una foto de hace tres meses, que es justo cuando el usuario
  // no se acuerda de lo que ya registró.
  const dated = toScannedMovements(readings, { ...options, existing: [] })
  const periods = new Set(dated.movements.map((m) => m.date.slice(0, 7)))
  const existing = (
    await Promise.all(
      [...periods].map((p) =>
        deps.transactions.listByUserPeriod(
          userId,
          // Meses calendario: el dedupe busca por fecha, no por el período del presupuesto.
          periodRange(Number(p.slice(0, 4)), Number(p.slice(5, 7)), "calendar", {})
        )
      )
    )
  )
    .flat()
    .filter((t) => t.accountId === accountId)
    .map(
      (t): ExistingMovement => ({
        date: t.date,
        amount: t.amount.toMajor(),
        direction: t.direction,
      })
    )

  return toScannedMovements(readings, { ...options, existing })
}

// --- Paso 2: crear los movimientos confirmados ---

export type ConfirmedMovement = {
  date: Date // medianoche UTC, como el alta manual
  description: string
  amount: number
  direction: Direction
}

// Se crean uno a uno por `createTransaction`: es el único camino que ajusta saldo y buckets, y el
// que lleva la puerta de las cuentas conectadas (`source: "bank-scan"`). Sin categoría a propósito
// — quedan en el triage, que es donde la app ya sabe categorizar en lote.
export async function confirmScannedMovements(
  deps: Deps,
  userId: string,
  accountId: string,
  movements: ConfirmedMovement[]
): Promise<{ created: number }> {
  const account = await requireAccount(deps, userId, accountId)
  if (movements.length === 0)
    throw new MovementScanError("No hay movimientos para registrar")
  if (movements.length > MAX_SCAN_MOVEMENTS)
    throw new MovementScanError(
      `Se pueden registrar hasta ${MAX_SCAN_MOVEMENTS} movimientos a la vez`
    )

  for (const m of movements) {
    // ponytail: sin transacción — cada movimiento se crea con su proyección, como el alta manual.
    // Si uno falla, los anteriores quedan creados y el usuario reintenta con los que faltan (la
    // dedupe del siguiente escaneo los marca).
    await createTransaction(deps, userId, {
      accountId,
      categoryId: null,
      amount: m.amount,
      currency: account.currency,
      direction: m.direction,
      description: m.description,
      date: m.date,
      source: "bank-scan",
    })
  }
  return { created: movements.length }
}
