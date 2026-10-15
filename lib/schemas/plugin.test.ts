import { test } from "node:test"
import assert from "node:assert/strict"
import { pluginTools } from "./plugin.ts"

test("Dado un plan de cuotas, cuando lo creo por chat, entonces la tarjeta exige la compra de origen y el préstamo se crea sin asociar una compra.", () => {
  const schema = pluginTools.lucaplan_crear_plan_cuotas.inputSchema
  const plan = {
    operationId: "crear-plan-cuotas",
    accountId: "cuenta-propia",
    categoryId: "categoria-propia",
    description: "Compra en tres cuotas",
    totalAmount: 90_000,
    installmentsCount: 3,
    startDate: "2026-10-15",
    dayOfMonth: 15,
    tolerancePct: 0,
  }

  assert.equal(schema.safeParse({ ...plan, kind: "card" }).success, false)
  assert.equal(
    schema.safeParse({ ...plan, kind: "card", sourceTransactionId: null }).success,
    false
  )
  assert.equal(
    schema.safeParse({ ...plan, kind: "card", sourceTransactionId: "compra-propia" }).success,
    true
  )
  assert.equal(
    schema.safeParse({ ...plan, kind: "loan", sourceTransactionId: "compra-propia" }).success,
    false
  )
  assert.equal(schema.safeParse({ ...plan, kind: "loan" }).success, true)
  assert.equal(
    schema.safeParse({ ...plan, kind: "loan", sourceTransactionId: null }).success,
    true
  )
})
