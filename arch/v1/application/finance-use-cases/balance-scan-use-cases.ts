// "Actualizar saldo" desde una captura de la app del banco: leer la imagen (IA) y, tras la
// confirmación del usuario, aplicar los saldos a la cuenta y sus buckets.
//
// Son dos pasos a propósito. La IA puede leer mal un dígito y devolver un monto perfectamente
// válido —$1.334.697 → $1.834.697—, algo que ninguna validación puede detectar. Por eso leer NO
// persiste: devuelve una propuesta que el usuario revisa y corrige. El paso que guarda recibe los
// montos confirmados y vuelve a correr las mismas fórmulas: el saldo derivado se calcula siempre en
// el servidor, sobre el cupo total que ya tiene la cuenta —ese no lo mueve ni la captura ni el
// cliente—.
import {
  AccountNotFoundError,
  NotOwnerError,
  type Account,
  type AccountRepository,
  type BalanceBucket,
  type BalanceBucketRepository,
  type BucketKind,
} from "../../domain/finance/finance.domain.ts"
import {
  BalanceScanError,
  EMPTY_BUCKET,
  limitMismatch,
  resolveBucket,
  resolveChecking,
  type BalanceReading,
  type BalanceScanReader,
  type BucketReading,
  type ResolvedBucket,
} from "../../domain/finance/balance-scan.domain.ts"
import { Money } from "../../domain/finance/money.ts"

type Deps = {
  accounts: AccountRepository
  balanceBuckets: BalanceBucketRepository
  balanceScan: BalanceScanReader
}

// Tipos de cuenta que la captura sabe leer: los que tienen saldos que el banco muestra en pantalla.
type ScannableType = "checking" | "credit_card"

function scannable(account: Account): ScannableType {
  if (account.accountType === "checking" || account.accountType === "credit_card")
    return account.accountType
  throw new BalanceScanError(
    "Solo se pueden leer saldos de una cuenta corriente o una tarjeta de crédito"
  )
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

const limitOf = (buckets: BalanceBucket[], kind: BucketKind): Money | null =>
  buckets.find((b) => b.kind === kind)?.limitAmount ?? null

// Lo que ve el usuario antes de confirmar. Solo lo LEÍDO: los derivados no se mandan porque el
// usuario todavía va a editar los montos, y un "así queda" calculado sobre la lectura original
// quedaría desactualizado en el primer tecleo. Se calculan al guardar, con lo que quedó escrito.
export type BalanceScanProposal = {
  reading: BalanceReading
  last4Matches: boolean // false ⇒ la captura es de OTRO instrumento (la UI corta ahí)
  mismatches: BucketMismatch[] // cupos donde lo leído no cuadra con el cupo total guardado
}

// Descuadre detectado en un cupo: la diferencia en unidad mayor. Sin texto: la frase la arma la UI.
export type BucketMismatch = {
  kind: BucketKind
  difference: number
  currency: "CLP" | "USD"
}

// --- Paso 1: leer la captura (no persiste nada) ---

export async function scanAccountBalance(
  deps: Deps,
  userId: string,
  accountId: string,
  imageDataUrls: string[]
): Promise<BalanceScanProposal | null> {
  const account = await requireAccount(deps, userId, accountId)
  const reading = await deps.balanceScan.read({
    imageDataUrls,
    accountType: scannable(account),
  })
  if (!reading) return null
  const buckets = await deps.balanceBuckets.listByAccount(accountId)
  return {
    reading,
    // Sin últimos 4 legibles no se puede afirmar que no coincide: se deja pasar y decide el usuario.
    last4Matches:
      !reading.last4 || !account.cardLast4 || reading.last4 === account.cardLast4,
    mismatches: mismatchesIn(scannable(account), reading, buckets),
  }
}

// Descuadres de la lectura contra el cupo total guardado: solo aparecen cuando la captura trajo con
// qué contrastar (disponible + usado, o el cupo total). NO bloquean —el usuario corrige el número en
// pantalla, o el cupo guardado quedó viejo—, pero son la única señal automática de un dígito mal
// leído.
function mismatchesIn(
  accountType: ScannableType,
  reading: BalanceReading,
  buckets: BalanceBucket[]
): BucketMismatch[] {
  const targets: [BucketKind, BucketReading, "CLP" | "USD"][] =
    accountType === "checking"
      ? [["overdraft", reading.overdraft, "CLP"]]
      : [
          ["credit_national", reading.national, "CLP"],
          ["credit_international", reading.international, "USD"],
        ]
  return targets.flatMap(([kind, bucketReading, currency]) => {
    const diff = limitMismatch(bucketReading, limitOf(buckets, kind), currency)
    return diff ? [{ kind, difference: diff.toMajor(), currency }] : []
  })
}

// --- Paso 2: aplicar los montos confirmados ---

export async function applyAccountBalance(
  deps: Deps,
  userId: string,
  accountId: string,
  confirmed: BalanceReading
): Promise<{ updatedBuckets: number }> {
  const account = await requireAccount(deps, userId, accountId)
  const buckets = await deps.balanceBuckets.listByAccount(accountId)
  const plan = resolveFor(scannable(account), confirmed, buckets)
  if (!plan.cash && plan.buckets.length === 0)
    throw new BalanceScanError(
      "Los montos no alcanzan para calcular ningún saldo"
    )

  const asOf = new Date()
  let updated = 0
  for (const { kind, amounts } of plan.buckets) {
    const bucket = buckets.find((b) => b.kind === kind)
    if (!bucket) continue // la cuenta no lleva ese cupo: no se inventa uno
    await deps.balanceBuckets.updateAmounts(bucket.id, { ...amounts, asOf })
    updated++
  }
  if (plan.cash) {
    const cash = buckets.find((b) => b.kind === "cash")
    if (cash) {
      await deps.balanceBuckets.updateAmounts(cash.id, {
        limitAmount: Money.zero("CLP"),
        used: Money.zero("CLP"),
        available: plan.cash,
        asOf,
      })
      updated++
    }
    await deps.accounts.setBalance(accountId, plan.cash)
  }
  // La tarjeta no tiene caja: su saldo es la deuda nacional en negativo (misma regla que el correo).
  const national = plan.buckets.find((b) => b.kind === "credit_national")
  if (national) await deps.accounts.setBalance(accountId, national.amounts.used.negate())
  return { updatedBuckets: updated }
}

// --- Fórmulas: qué se puede calcular con lo leído + lo ya guardado ---

type Plan = {
  cash: Money | null
  buckets: { kind: BucketKind; amounts: ResolvedBucket }[]
}

function resolveFor(
  accountType: ScannableType,
  reading: BalanceReading,
  buckets: BalanceBucket[]
): Plan {
  const out: Plan = { cash: null, buckets: [] }
  const push = (kind: BucketKind, amounts: ResolvedBucket | null) => {
    if (amounts) out.buckets.push({ kind, amounts })
  }

  if (accountType === "checking") {
    const checking = resolveChecking(reading, limitOf(buckets, "overdraft"))
    if (checking) {
      out.cash = checking.cash
      push("overdraft", checking.overdraft)
    } else {
      // Sin saldo legible todavía puede venir la línea sola.
      push(
        "overdraft",
        resolveBucket(reading.overdraft, limitOf(buckets, "overdraft"), "CLP")
      )
    }
    return out
  }

  push(
    "credit_national",
    resolveBucket(reading.national, limitOf(buckets, "credit_national"), "CLP")
  )
  push(
    "credit_international",
    resolveBucket(
      reading.international,
      limitOf(buckets, "credit_international"),
      "USD"
    )
  )
  return out
}

// Lectura vacía: base para lo que arma el cliente al confirmar.
export const emptyReading = (): BalanceReading => ({
  last4: null,
  cash: null,
  overdraft: EMPTY_BUCKET,
  national: EMPTY_BUCKET,
  international: EMPTY_BUCKET,
})
