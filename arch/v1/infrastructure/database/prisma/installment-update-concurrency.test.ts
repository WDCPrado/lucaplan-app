// Reproduce la edición calculada antes de una conciliación, usando el caso de uso y adapter
// reales. El cruce y rollback contra PostgreSQL están en verify-card-reconciliation.ts.
import test from "node:test"
import assert from "node:assert/strict"
import { InvalidInstallmentPlanError } from "../../../domain/finance/installment.domain.ts"
import { updateInstallmentItem } from "../../../application/finance-use-cases/installment-use-cases.ts"

function fixture() {
  return {
    id: "plan", userId: "owner", kind: "card", accountId: "card",
    categoryId: "shopping", sourceTransactionId: "purchase", description: "Compra demo",
    totalAmount: 600000, currency: "CLP", installmentsCount: 6,
    startDate: new Date("2030-01-22"), dayOfMonth: 22, tolerancePct: 0, completedAt: null,
    items: Array.from({ length: 6 }, (_, i) => ({
      id: `item-${i}`, index: i + 1, dueDate: new Date(Date.UTC(2030, i, 22)),
      amount: 100000, paidOutsideApp: false, transaction: null,
    })),
  }
}

let current = fixture()
let beforeWrite = () => {}
let itemWrites = 0
const db = {
  installmentPlan: {
    updateMany: async ({ where, data }: {
      where: { id: string; userId: string; totalAmount: string }
      data: { totalAmount: string }
    }) => {
      assert.equal(data.totalAmount, where.totalAmount, "el lock exige un UPDATE real")
      return { count: current.id === where.id && current.userId === where.userId &&
        current.totalAmount === Number(where.totalAmount) ? 1 : 0 }
    },
    findFirst: async () => structuredClone(current),
  },
  installmentItem: {
    update: async ({ where, data }: {
      where: { id: string; planId: string; plan: { userId: string } }
      data: { amount: string; dueDate?: Date }
    }) => {
      assert.equal(where.planId, current.id)
      assert.equal(where.plan.userId, current.userId)
      const item = current.items.find((i) => i.id === where.id)!
      item.amount = Number(data.amount)
      if (data.dueDate) item.dueDate = data.dueDate
      itemWrites++
      return item
    },
  },
}

;(globalThis as unknown as { prisma: unknown }).prisma = {
  installmentPlan: { findUnique: async () => structuredClone(current) },
  $transaction: async (run: (tx: typeof db) => Promise<unknown>) => {
    beforeWrite()
    return run(db)
  },
}
const { installmentPlanRepository } = await import("./installment.infrastructure.ts")
const edit = () => updateInstallmentItem(
  { installments: installmentPlanRepository },
  "owner",
  { planId: "plan", itemId: "item-0", dueDate: new Date("2030-01-22"), amount: 110000 }
)

test("rechaza una edición calculada antes de corregir el total financiado", async () => {
  current = fixture()
  itemWrites = 0
  beforeWrite = () => {
    current.totalAmount = 678000
    current.items.forEach((item) => { item.amount = 113000 })
  }
  await assert.rejects(edit(), (error: unknown) =>
    error instanceof InvalidInstallmentPlanError && /El plan cambió/.test(error.message))
  assert.equal(itemWrites, 0)
  assert.equal(current.totalAmount, 678000)
  assert.deepEqual(current.items.map((i) => i.amount), Array(6).fill(113000))
})

test("rechaza el reparto obsoleto aunque la conciliación conserve el total", async () => {
  current = fixture()
  itemWrites = 0
  beforeWrite = () => {
    current.items[0].amount = 99000
    current.items[1].amount = 101000
  }
  await assert.rejects(edit(), /El plan cambió/)
  assert.equal(itemWrites, 0)
  assert.deepEqual(current.items.map((i) => i.amount), [99000, 101000, 100000, 100000, 100000, 100000])
})

test("una edición con el plan vigente sigue conservando su total financiado", async () => {
  current = fixture()
  current.totalAmount = 678000
  current.items.forEach((item) => { item.amount = 113000 })
  itemWrites = 0
  beforeWrite = () => {}
  const result = await edit()
  assert.equal(itemWrites, 6)
  assert.equal(result.totalAmount.toMajor(), 678000)
  assert.deepEqual(result.items.map((i) => i.amount.toMajor()), [110000, 113600, 113600, 113600, 113600, 113600])
})
