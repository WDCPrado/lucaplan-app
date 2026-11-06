// "Actualizar saldo": aplicar a la cuenta y sus buckets los montos que confirma el usuario (pantalla
// o herramienta MCP). El saldo derivado se calcula siempre en el servidor, sobre el cupo total que
// ya tiene la cuenta —ese no lo mueve el cliente—.
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
  AccountBalanceError,
  EMPTY_BUCKET,
  resolveBucket,
  resolveChecking,
  type BalanceReading,
  type ResolvedBucket,
} from "../../domain/finance/account-balance.domain.ts"
import { Money } from "../../domain/finance/money.ts"

type Deps = {
  accounts: AccountRepository
  balanceBuckets: BalanceBucketRepository
}

// Tipos de cuenta con saldos que se actualizan así: caja/línea o cupos de tarjeta.
type BalanceAccountType = "checking" | "credit_card"

function balanceAccountType(account: Account): BalanceAccountType {
  if (account.accountType === "checking" || account.accountType === "credit_card")
    return account.accountType
  throw new AccountBalanceError(
    "Solo se pueden actualizar saldos de una cuenta corriente o una tarjeta de crédito"
  )
}

async function requireAccount(
  deps: Pick<Deps, "accounts">,
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

export async function applyAccountBalance(
  deps: Deps,
  userId: string,
  accountId: string,
  confirmed: BalanceReading
): Promise<{ updatedBuckets: number }> {
  const account = await requireAccount(deps, userId, accountId)
  const buckets = await deps.balanceBuckets.listByAccount(accountId)
  const plan = resolveFor(balanceAccountType(account), confirmed, buckets)
  if (!plan.cash && plan.buckets.length === 0)
    throw new AccountBalanceError(
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

// --- Fórmulas: qué se puede calcular con lo informado + lo ya guardado ---

type Plan = {
  cash: Money | null
  buckets: { kind: BucketKind; amounts: ResolvedBucket }[]
}

function resolveFor(
  accountType: BalanceAccountType,
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
      // Sin saldo todavía puede venir la línea sola.
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

// Montos vacíos: base para lo que arma el cliente al confirmar.
export const emptyReading = (): BalanceReading => ({
  last4: null,
  cash: null,
  overdraft: EMPTY_BUCKET,
  national: EMPTY_BUCKET,
  international: EMPTY_BUCKET,
})
