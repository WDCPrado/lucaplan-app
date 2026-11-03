// El reproceso del correo no deshace la neutralización de una compra pasada a cuotas: isInternal
// nunca baja de true a false (si no, la compra vuelve a contar entera además de sus cuotas).
// Sin base: `client.ts` reutiliza `globalThis.prisma`, así que se deja un Prisma falso antes del import.
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../../domain/finance/money.ts"

const updates: { isInternal: boolean }[] = []
let previous: { isInternal: boolean; reconciliation: null } | null = null
const db = {
  transaction: {
    findUnique: async () => previous,
    findMany: async () => [],
    upsert: async ({ update }: { update: { isInternal: boolean } }) => { updates.push(update) },
  },
}
;(globalThis as unknown as { prisma: unknown }).prisma = {
  ...db,
  $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
}
const { emailSetupStore } = await import("./email-connection.infrastructure.ts")

const movement = (isInternal: boolean) => ({
  accountId: "card", bucketId: null, externalId: "x1", date: new Date("2026-10-03T00:00:00Z"),
  description: "JETSMART AIRLINES", amount: Money.of(598398, "CLP"), direction: "debit" as const, isInternal,
})

test("reprocesar el aviso de una compra neutralizada la deja interna", async () => {
  updates.length = 0
  previous = { isInternal: true, reconciliation: null }
  await emailSetupStore.upsertMovements("u1", [movement(false)])
  assert.equal(updates[0].isInternal, true)
})

test("un aviso que no era interno sigue sin serlo", async () => {
  updates.length = 0
  previous = { isInternal: false, reconciliation: null }
  await emailSetupStore.upsertMovements("u1", [movement(false)])
  assert.equal(updates[0].isInternal, false)
})
