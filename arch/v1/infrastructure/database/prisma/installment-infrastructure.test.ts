// WDC-171: la cuota `card` que registra la app va contra el cupo de su moneda; sin bucket, la
// conciliación siguiente de la tarjeta la rechazaba («Movimiento posterior sin bucket»).
// Sin base de datos: `client.ts` reutiliza `globalThis.prisma`, así que se deja un Prisma falso
// ANTES de importar el repo. Cubre solo lo que usa `registerItemTransaction`.
// Corre con: node --test arch/v1/infrastructure/database/prisma/installment-infrastructure.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../../domain/finance/money.ts"
import type { InstallmentPlan } from "../../../domain/finance/installment.domain.ts"

const buckets = [
  { id: "b-nac", userId: "u1", accountId: "tarjeta", kind: "credit_national", currency: "CLP" },
  { id: "b-int", userId: "u1", accountId: "tarjeta", kind: "credit_international", currency: "USD" },
]
const created: { bucketId: string | null; installmentItemId: string }[] = []

// WDC-178: movimientos del adoptTransaction (id → fila). `items` dice qué movimiento salda cada cuota.
// `generated`: lo creó «Generar cuota»; `reimbursed`: tiene reembolsos (pagados o recibidos).
type Row = {
  id: string
  externalId: string | null
  installmentItemId: string | null
  generated?: boolean
  reimbursed?: boolean
  recurringTemplateId?: string | null
}
let rows: Row[] = []
const items = new Map<string, string>()

const fake: Record<string, unknown> & { installmentPlan?: unknown } = {
  installmentItem: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const tx = rows.find((r) => r.id === items.get(where.id))
      return {
        id: where.id,
        index: 1,
        paidOutsideApp: false,
        transaction: tx
          ? { id: tx.id, externalId: tx.externalId, generatedFromInstallment: tx.generated ?? false }
          : null,
      }
    },
  },
  balanceBucket: {
    findFirst: async ({ where }: { where: Record<string, string> }) =>
      buckets.find((b) => Object.entries(where).every(([k, v]) => b[k as keyof typeof b] === v)) ?? null,
  },
  transaction: {
    create: async ({ data }: { data: { bucketId: string | null; installmentItemId: string } }) => {
      created.push(data)
      return data
    },
    findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
    // Respeta los filtros que el borrado le exige al movimiento reemplazado.
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const none = JSON.stringify({ none: {} })
      const guarded =
        where.externalId === null &&
        where.generatedFromInstallment === true &&
        where.recurringTemplateId === null &&
        JSON.stringify(where.reimbursementsPaid) === none &&
        JSON.stringify(where.reimbursementsReceived) === none
      const matches = (r: Row) =>
        guarded &&
        r.id === where.id &&
        r.externalId === null &&
        r.generated === true &&
        !r.reimbursed &&
        (r.recurringTemplateId ?? null) === null
      const before = rows.length
      rows = rows.filter((r) => !matches(r))
      return { count: before - rows.length }
    },
    updateMany: async ({ where, data }: { where: { id: string; installmentItemId: null }; data: { installmentItemId: string } }) => {
      const r = rows.find((x) => x.id === where.id && x.installmentItemId === null)
      if (!r) return { count: 0 }
      r.installmentItemId = data.installmentItemId
      items.set(data.installmentItemId, r.id)
      return { count: 1 }
    },
  },
  // Transacción de mentira: copia las filas y las restaura si el callback lanza.
  $transaction: async (fn: (db: unknown) => Promise<unknown>) => {
    const snapshot = rows.map((r) => ({ ...r }))
    const links = new Map(items)
    try {
      return await fn(fake)
    } catch (e) {
      rows = snapshot
      items.clear()
      for (const [k, v] of links) items.set(k, v)
      throw e
    }
  },
}
;(globalThis as unknown as { prisma: unknown }).prisma = fake

const { installmentPlanRepository } = await import("./installment.infrastructure.ts")

const plan = (kind: "card" | "loan", currency: "CLP" | "USD", accountId = "tarjeta"): InstallmentPlan => ({
  id: `p-${kind}-${currency}`, userId: "u1", kind, accountId, categoryId: "c1", sourceTransactionId: null,
  description: "Notebook", totalAmount: Money.of(300, currency), currency, installmentsCount: 3,
  startDate: new Date("2026-10-15T00:00:00Z"), dayOfMonth: 15, tolerancePct: 0, completedAt: null, items: [],
})

test("cuo-bucket: la cuota de tarjeta queda en el cupo nacional (CLP) o internacional (USD) de su cuenta", async () => {
  const fecha = new Date("2026-10-15T00:00:00Z")
  assert.equal(await installmentPlanRepository.registerItemTransaction(plan("card", "CLP"), "i1", fecha, Money.of(100, "CLP")), true)
  assert.equal(await installmentPlanRepository.registerItemTransaction(plan("card", "USD"), "i2", fecha, Money.of(100, "USD")), true)
  // Sin cupo de esa moneda en la cuenta, o un crédito de consumo: sin bucket.
  await installmentPlanRepository.registerItemTransaction(plan("card", "CLP", "otra"), "i3", fecha, Money.of(100, "CLP"))
  await installmentPlanRepository.registerItemTransaction(plan("loan", "CLP"), "i4", fecha, Money.of(100, "CLP"))
  assert.deepEqual(
    created.map((c) => [c.installmentItemId, c.bucketId]),
    [["i1", "b-nac"], ["i2", "b-int"], ["i3", null], ["i4", null]]
  )
})

test("WDC-178: el correo reemplaza el movimiento manual de una cuota y nunca uno que ya vino del banco", async () => {
  const loan = plan("loan", "CLP", "corriente")
  const seed = (manualExternalId: string | null) => {
    rows = [
      { id: "previo", externalId: manualExternalId, installmentItemId: "c1", generated: true },
      { id: "correo", externalId: "bch-1", installmentItemId: null },
      { id: "a-mano", externalId: null, installmentItemId: null },
    ]
    items.clear()
    items.set("c1", "previo")
  }

  // Manual + correo: el manual desaparece y la cuota queda con el del banco.
  seed(null)
  assert.equal(await installmentPlanRepository.adoptTransaction(loan, "c1", "correo"), true)
  assert.deepEqual(rows.map((r) => r.id), ["correo", "a-mano"])
  assert.equal(items.get("c1"), "correo")

  // Saldada por el banco: no se pisa.
  seed("bch-0")
  assert.equal(await installmentPlanRepository.adoptTransaction(loan, "c1", "correo"), false)
  assert.equal(items.get("c1"), "previo")
  assert.equal(rows.length, 3)

  // Manual reemplazado por otro manual: no (solo el banco manda).
  seed(null)
  assert.equal(await installmentPlanRepository.adoptTransaction(loan, "c1", "a-mano"), false)
  assert.equal(items.get("c1"), "previo")
  assert.equal(rows.length, 3)
})

test("WDC-178: «Generar cuota» marca su movimiento como generado", async () => {
  created.length = 0
  await installmentPlanRepository.registerItemTransaction(plan("loan", "CLP"), "i9", new Date("2026-10-15T00:00:00Z"), Money.of(100, "CLP"))
  assert.equal((created[0] as unknown as { generatedFromInstallment: boolean }).generatedFromInstallment, true)
})

test("WDC-178: el correo no reemplaza un movimiento escrito y asignado por la persona, ni uno generado con reembolsos o recurrente", async () => {
  const loan = plan("loan", "CLP", "corriente")
  const cases: [string, Partial<Row>][] = [
    ["escrito por la persona y asignado", { generated: false }],
    ["generado con reembolsos", { generated: true, reimbursed: true }],
    ["generado y vinculado a una recurrente", { generated: true, recurringTemplateId: "rt1" }],
  ]
  for (const [label, over] of cases) {
    rows = [
      { id: "previo", externalId: null, installmentItemId: "c1", ...over },
      { id: "correo", externalId: "bch-1", installmentItemId: null },
    ]
    items.clear()
    items.set("c1", "previo")
    assert.equal(await installmentPlanRepository.adoptTransaction(loan, "c1", "correo"), false, label)
    assert.deepEqual(rows.map((r) => r.id), ["previo", "correo"], `${label}: no se borra nada`)
    assert.equal(items.get("c1"), "previo", `${label}: la cuota conserva su movimiento`)
  }
})

test("WDC-178: solo un movimiento generado por «Generar cuota» cuenta como reemplazable al leer el plan", async () => {
  const row = (generatedFromInstallment: boolean) => ({
    id: "p", userId: "u1", kind: "loan", accountId: "a", categoryId: "c", description: "Crédito",
    totalAmount: 100, currency: "CLP", installmentsCount: 1, startDate: new Date(), dayOfMonth: 5,
    tolerancePct: 0, completedAt: null,
    items: [{ id: "c1", index: 1, dueDate: new Date(), amount: 100, paidOutsideApp: false,
      transaction: { id: "t", externalId: null, generatedFromInstallment } }],
  })
  fake.installmentPlan = { findUnique: async () => row(false) }
  assert.equal((await installmentPlanRepository.findById("p"))!.items[0].manualTransaction, false)
  fake.installmentPlan = { findUnique: async () => row(true) }
  assert.equal((await installmentPlanRepository.findById("p"))!.items[0].manualTransaction, true)
})
