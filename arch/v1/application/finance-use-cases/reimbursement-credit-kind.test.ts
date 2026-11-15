// WDC-183: vincular un reembolso deja el abono como `reimbursement`, así deja de contar en el
// ingreso del plan. Sin base: `client.ts` reutiliza `globalThis.prisma`, así que se deja un Prisma
// falso ANTES de importar el adapter. Cubre solo lo que usa `linkReimbursement`.
import { test } from "node:test"
import assert from "node:assert/strict"

type Row = Record<string, unknown> & { id: string }
let txs: Row[] = []
const updates: { id: string; data: Record<string, unknown> }[] = []
const fake: Record<string, unknown> = {
  $transaction: async (fn: (db: unknown) => Promise<unknown>) => fn(fake),
  $queryRaw: async () => [],
  transaction: {
    findFirst: async ({ where }: { where: { id: string } }) =>
      txs.find((t) => t.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      updates.push({ id: where.id, data })
      return Object.assign(txs.find((t) => t.id === where.id)!, data)
    },
  },
  expenseReimbursement: {
    findUnique: async () => null,
    aggregate: async () => ({ _sum: { amount: 0 } }),
    create: async () => ({ id: "r1" }),
  },
  category: { findFirst: async () => ({ id: "comida", name: "Comida" }) },
  appSetting: { findMany: async () => [] },
}
;(globalThis as unknown as { prisma: unknown }).prisma = fake

const { linkReimbursement } = await import(
  "../../infrastructure/database/prisma/reimbursement.infrastructure.ts"
)

const base = {
  userId: "u1",
  status: "confirmed",
  isInternal: false,
  currency: "CLP",
  transactionDate: new Date("2026-11-05T00:00:00Z"),
}
const setup = (creditKind: string) => {
  updates.length = 0
  txs = [
    { ...base, id: "asado", direction: "debit", amount: 60_000, categoryId: "comida" },
    { ...base, id: "transf-juan", direction: "credit", amount: 20_000, creditKind },
  ]
}

test("vincular un abono de ingreso como reembolso de un gasto lo deja como reembolso (sale del ingreso del plan)", async () => {
  setup("income")
  await linkReimbursement("u1", { expenseId: "asado", creditId: "transf-juan", amount: 20_000 })
  assert.equal(txs[1].creditKind, "reimbursement")
  assert.deepEqual(updates, [{ id: "transf-juan", data: { creditKind: "reimbursement" } }])
})

test("un reverso vinculado como reembolso conserva su tipo", async () => {
  setup("reversal")
  await linkReimbursement("u1", { expenseId: "asado", creditId: "transf-juan", amount: 20_000 })
  assert.equal(txs[1].creditKind, "reversal")
  assert.deepEqual(updates, [])
})
