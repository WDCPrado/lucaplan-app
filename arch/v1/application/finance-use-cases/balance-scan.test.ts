// Aplicar a la cuenta los saldos confirmados de una captura, con fakes en memoria de los ports.
// Corre con: node --test arch/v1/application/finance-use-cases/balance-scan.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type {
  Account,
  AccountRepository,
  BalanceBucket,
  BalanceBucketRepository,
  BucketKind,
} from "../../domain/finance/finance.domain.ts"
import {
  BalanceScanError,
  type BalanceReading,
  type BalanceScanReader,
} from "../../domain/finance/balance-scan.domain.ts"
import { applyAccountBalance, emptyReading } from "./balance-scan-use-cases.ts"

const clp = (n: number) => Money.of(n, "CLP")

const acc = (over: Partial<Account> = {}): Account => ({
  id: "a1",
  userId: "u1",
  bankId: "b1",
  name: "Cuenta corriente",
  accountType: "checking",
  currency: "CLP",
  balance: clp(842350),
  overdraftLimit: clp(0),
  color: null,
  cardLast4: "8900",
  provider: "manual",
  externalId: null,
  ...over,
})

const bucket = (
  kind: BucketKind,
  limit: number,
  used: number,
  currency: "CLP" | "USD" = "CLP"
): BalanceBucket => ({
  id: `bk-${kind}`,
  userId: "u1",
  accountId: "a1",
  cardId: null,
  kind,
  currency,
  limitAmount: Money.of(limit, currency),
  used: Money.of(used, currency),
  available: Money.of(limit - used, currency),
  asOf: null,
})

class FakeAccounts implements AccountRepository {
  balance: Money | null = null
  private account: Account
  // Sin propiedades de parámetro (`constructor(private x)`): node --test las rechaza al despojar tipos.
  constructor(account: Account) {
    this.account = account
  }
  async listByUser() {
    return [this.account]
  }
  async findById(id: string) {
    return id === this.account.id ? this.account : null
  }
  async create(): Promise<never> {
    throw new Error("no usado")
  }
  async listByBank() {
    return []
  }
  setBalance: AccountRepository["setBalance"] = async (_id, balance) => {
    this.balance = balance
  }
}

class FakeBuckets implements BalanceBucketRepository {
  written = new Map<string, { limitAmount: Money; used: Money; available: Money }>()
  private list: BalanceBucket[]
  constructor(list: BalanceBucket[]) {
    this.list = list
  }
  async listByUser() {
    return this.list
  }
  async listByAccount() {
    return this.list
  }
  updateAmounts: BalanceBucketRepository["updateAmounts"] = async (
    id,
    amounts
  ) => {
    this.written.set(id, amounts)
  }
}

// La lectura por IA no participa de este paso: aplicar recibe los montos ya confirmados.
const reader: BalanceScanReader = { read: async () => null }

const deps = (account: Account, buckets: BalanceBucket[]) => {
  const accounts = new FakeAccounts(account)
  const balanceBuckets = new FakeBuckets(buckets)
  return { accounts, balanceBuckets, balanceScan: reader }
}

const reading = (over: Partial<BalanceReading>): BalanceReading => ({
  ...emptyReading(),
  ...over,
})

test("corriente en sobregiro: caja en cero, deuda a la línea y saldo negativo en la cuenta", async () => {
  const d = deps(acc(), [
    bucket("cash", 0, 0),
    bucket("overdraft", 1_000_000, 0),
  ])
  const res = await applyAccountBalance(
    d,
    "u1",
    "a1",
    reading({
      cash: -25_650,
      overdraft: { limit: null, available: 955_415, used: null },
    })
  )
  assert.equal(res.updatedBuckets, 2)
  assert.equal(d.accounts.balance?.toMajor(), 0)
  assert.equal(d.balanceBuckets.written.get("bk-cash")?.available.toMajor(), 0)
  const od = d.balanceBuckets.written.get("bk-overdraft")
  // El cupo guardado no se toca: el usado es lo que le falta al disponible para llegar a él.
  assert.equal(od?.limitAmount.toMajor(), 1_000_000)
  assert.equal(od?.used.toMajor(), 44_585)
})

test("tarjeta: cada cupo va a su bucket y el saldo de la cuenta es la deuda nacional", async () => {
  const d = deps(acc({ accountType: "credit_card", cardLast4: "2120" }), [
    bucket("credit_national", 3_000_000, 1_900_000),
    bucket("credit_international", 2_500, 700, "USD"),
  ])
  await applyAccountBalance(
    d,
    "u1",
    "a1",
    reading({
      national: { limit: null, available: 1_334_697, used: null },
      international: { limit: null, available: 2_069, used: null },
    })
  )
  const nat = d.balanceBuckets.written.get("bk-credit_national")
  assert.equal(nat?.used.toMajor(), 1_665_303)
  assert.equal(nat?.limitAmount.toMajor(), 3_000_000)
  const intl = d.balanceBuckets.written.get("bk-credit_international")
  assert.equal(intl?.used.toMajor(), 431)
  assert.equal(intl?.used.currency, "USD")
  assert.equal(d.accounts.balance?.toMajor(), -1_665_303)
})

// El cupo total vive en la cuenta: un cliente que mande otro no lo mueve.
test("un cupo total en el body confirmado se ignora", async () => {
  const d = deps(acc({ accountType: "credit_card", cardLast4: "2120" }), [
    bucket("credit_national", 3_000_000, 1_900_000),
  ])
  await applyAccountBalance(
    d,
    "u1",
    "a1",
    reading({ national: { limit: 9_000_000, available: 1_334_697, used: null } })
  )
  const nat = d.balanceBuckets.written.get("bk-credit_national")
  assert.equal(nat?.limitAmount.toMajor(), 3_000_000)
  assert.equal(nat?.used.toMajor(), 1_665_303)
})

test("solo la línea legible: se actualiza ese bucket y la caja queda intacta", async () => {
  const d = deps(acc(), [bucket("cash", 0, 0), bucket("overdraft", 1_000_000, 0)])
  await applyAccountBalance(
    d,
    "u1",
    "a1",
    reading({ overdraft: { limit: null, available: 900_000, used: null } })
  )
  assert.equal(d.balanceBuckets.written.has("bk-cash"), false)
  assert.equal(
    d.balanceBuckets.written.get("bk-overdraft")?.used.toMajor(),
    100_000
  )
  assert.equal(d.accounts.balance, null)
})

test("sin montos suficientes no se escribe nada", async () => {
  const d = deps(acc(), [bucket("cash", 0, 0)])
  await assert.rejects(
    () => applyAccountBalance(d, "u1", "a1", emptyReading()),
    BalanceScanError
  )
  assert.equal(d.balanceBuckets.written.size, 0)
})

test("una cuenta de otro usuario no se toca", async () => {
  const d = deps(acc(), [bucket("cash", 0, 0)])
  await assert.rejects(() =>
    applyAccountBalance(d, "otro", "a1", reading({ cash: 1000 }))
  )
})

test("un tipo de cuenta sin saldos en pantalla se rechaza", async () => {
  const d = deps(acc({ accountType: "investment" }), [])
  await assert.rejects(
    () => applyAccountBalance(d, "u1", "a1", reading({ cash: 1000 })),
    BalanceScanError
  )
})
