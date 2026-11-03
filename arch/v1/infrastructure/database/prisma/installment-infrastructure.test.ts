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

;(globalThis as unknown as { prisma: unknown }).prisma = {
  installmentItem: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      ({ id: where.id, index: 1, paidOutsideApp: false, transaction: null }),
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
  },
}

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
