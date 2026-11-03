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

test("Dado un pago enganchado en la cuota equivocada, cuando el chat pide moverlo, entonces la herramienta lucaplan_mover_pago_cuota es de escritura, exige la clave de operación y acepta destino completo o ninguno", () => {
  const tools: Record<string, { scope: string; readOnly: boolean; inputSchema: { safeParse(v: unknown): { success: boolean } } }> = pluginTools
  const tool = tools.lucaplan_mover_pago_cuota
  assert.ok(tool, "falta la herramienta lucaplan_mover_pago_cuota")
  assert.equal(tool.scope, "finance:write")
  assert.equal(tool.readOnly, false)
  const origen = { operationId: "mover-cuota-6", planId: "viaje-jo", itemId: "cuota-6" }
  const ok = (v: unknown) => tool.inputSchema.safeParse(v).success
  assert.equal(ok(origen), true, "soltar sin destino")
  assert.equal(ok({ ...origen, toPlanId: "credito-consumo", toItemId: "cuota-5" }), true)
  assert.equal(ok({ planId: origen.planId, itemId: origen.itemId }), false, "sin operationId")
  assert.equal(ok({ ...origen, toPlanId: "credito-consumo" }), false, "destino sin cuota")
  assert.equal(ok({ ...origen, toItemId: "cuota-5" }), false, "cuota sin plan destino")
  assert.equal(ok({ ...origen, userId: "otro" }), false, "claves extra")
  assert.equal(ok({ ...origen, transactionId: "tx-265708" }), false, "no elige el movimiento: es el de la cuota")
})

test("reembolso MCP exige gasto, abono, cantidad positiva e idempotencia", () => {
  const schema = pluginTools.lucaplan_vincular_reembolso.inputSchema
  const valid = { expenseId: "gasto-banco", creditId: "abono-banco", amount: 50000, operationId: "reembolso-caso-1" }
  assert.equal(schema.safeParse(valid).success, true)
  assert.equal(schema.safeParse({ ...valid, amount: 0 }).success, false)
  assert.equal(schema.safeParse({ ...valid, amount: -10 }).success, false)
  assert.equal(schema.safeParse({ ...valid, amount: 500.5 }).success, false)
  assert.equal(schema.safeParse({ ...valid, operationId: "" }).success, false)
})
test("vinculación de abono bancario con fuente de ingreso requiere identificadores e idempotencia", () => {
  const schema = pluginTools.lucaplan_vincular_abono_ingreso.inputSchema
  const valid = { incomeId: "fuente", transactionId: "abono", operationId: "vinculacion-1" }
  assert.equal(schema.safeParse(valid).success, true)
  assert.equal(schema.safeParse({ ...valid, transactionId: "" }).success, false)
  assert.equal(schema.safeParse({ ...valid, operationId: "" }).success, false)
})

test("Dado una cuota de tarjeta, cuando el chat lee la herramienta lucaplan_pagar_cuota, entonces su descripción dice que el pago de la tarjeta no la cobra sola y que se salda al conciliar la factura", () => {
  const { description } = pluginTools.lucaplan_pagar_cuota
  assert.match(description, /tarjeta/i)
  assert.match(description, /no se (cobran|saldan|pagan) sol/i)
  assert.match(description, /concilia/i)
})
