// Editar un movimiento conciliado (WDC-123): tocar importe o fecha borra su conciliación;
// tocar solo categoría o descripción la conserva. Contrato propuesto: `UpdateTransaction`
// lleva `clearReconciliation?: boolean` y el repo deja `reconciliation` en null cuando es true.
// Corre con: node --test arch/v1/application/finance-use-cases/update-transaction-reconciliation.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type {
  Account,
  AccountRepository,
  Transaction,
  TransactionRepository,
  UpdateTransaction,
} from "../../domain/finance/finance.domain.ts"
import { updateTransaction } from "./update-transaction-use-case.ts"

const account: Account = {
  id: "a1",
  userId: "u1",
  bankId: "b1",
  name: "Tarjeta",
  accountType: "credit_card",
  currency: "CLP",
  balance: Money.of(0, "CLP"),
  overdraftLimit: Money.of(0, "CLP"),
  color: null,
  cardLast4: null,
  provider: "manual",
  externalId: null,
}
const conciliado = (over: Partial<Transaction> = {}): Transaction => ({
  id: "t1",
  userId: "u1",
  accountId: "a1",
  categoryId: "super",
  date: new Date("2026-10-06T00:00:00Z"),
  description: "LIDER EXPRESS 12",
  amount: Money.of(12990, "CLP"),
  direction: "debit",
  status: "confirmed",
  isInternal: false,
  externalId: null,
  ...over,
})

/** Repo en memoria que guarda la conciliación aparte, como la columna `reconciliation`. */
function depsWith(tx: Transaction) {
  const row = { tx, reconciliation: { source: "Cartola octubre", evidence: "fila 4" } as unknown }
  const accounts = {
    findById: async (id: string) => (id === account.id ? account : null),
  } as unknown as AccountRepository
  const transactions = {
    findById: async (id: string) => (id === row.tx.id ? row.tx : null),
    update: async (input: UpdateTransaction & { clearReconciliation?: boolean }) => {
      if (input.clearReconciliation) row.reconciliation = null
      row.tx = { ...row.tx, ...input }
      return row.tx
    },
  } as unknown as TransactionRepository
  return { deps: { accounts, transactions }, row }
}
const edit = (over: Partial<Parameters<typeof updateTransaction>[2]> = {}) => ({
  transactionId: "t1",
  description: "LIDER EXPRESS 12",
  amount: 12990,
  direction: "debit" as const,
  categoryId: "super",
  date: new Date("2026-10-06"),
  ...over,
})

test("editar el importe o la fecha de un movimiento conciliado le quita la conciliación; cambiar solo categoría o descripción la conserva", async () => {
  // Importe: un peso de diferencia ya cuenta.
  const importe = depsWith(conciliado())
  await updateTransaction(importe.deps, "u1", edit({ amount: 12991 }))
  assert.equal(importe.row.reconciliation, null, "importe")

  // Fecha: un día después.
  const fecha = depsWith(conciliado())
  await updateTransaction(fecha.deps, "u1", edit({ date: new Date("2026-10-07") }))
  assert.equal(fecha.row.reconciliation, null, "fecha")

  // Moneda: conciliado en USD sobre una tarjeta en CLP; editarlo lo deja en USD, sin conversión
  // ni cambio del saldo CLP. Editar solo la descripción conserva la conciliación.
  const usd = depsWith(conciliado({ amount: Money.of(13.5, "USD") }))
  await updateTransaction(usd.deps, "u1", edit({ amount: 13.5, description: "AMAZON" }))
  assert.deepEqual(usd.row.tx.amount, Money.of(13.5, "USD"), "sigue en USD con el mismo importe")
  assert.deepEqual(account.balance, Money.of(0, "CLP"), "saldo CLP sin cambio")
  assert.notEqual(usd.row.reconciliation, null, "USD: solo descripción la conserva")
  // Editar su importe sí la borra.
  const usdImporte = depsWith(conciliado({ amount: Money.of(13.5, "USD") }))
  await updateTransaction(usdImporte.deps, "u1", edit({ amount: 14 }))
  assert.deepEqual(usdImporte.row.tx.amount, Money.of(14, "USD"), "nuevo importe en USD")
  assert.equal(usdImporte.row.reconciliation, null, "USD: importe la borra")

  // Solo categoría y descripción, misma fecha civil e importe: se conserva.
  const meta = depsWith(conciliado())
  await updateTransaction(
    meta.deps,
    "u1",
    edit({ categoryId: "hogar", description: "Supermercado Líder", date: new Date("2026-10-06") })
  )
  assert.notEqual(meta.row.reconciliation, null, "categoría y descripción")
})
