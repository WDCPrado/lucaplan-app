import assert from "node:assert/strict"
import test from "node:test"
import { pluginTools } from "./schemas/plugin.ts"

const tool = pluginTools.lucaplan_registrar_cargo_bancario
const valid = {
  accountId: "connected-bank-id",
  date: "2026-10-22",
  description: "ARAMCO",
  amount: 1490,
  currency: "CLP",
  operationId: "import-aramco-20261022",
}
test("registro bancario MCP solo acepta datos completos y operationId", () => {
  assert.equal(tool.readOnly, false)
  assert.equal(tool.inputSchema.safeParse(valid).success, true)
  assert.equal(tool.inputSchema.safeParse({ ...valid, amount: -1490 }).success, false)
  assert.equal(tool.inputSchema.safeParse({ ...valid, operationId: undefined }).success, false)
  assert.equal(tool.inputSchema.safeParse({ ...valid, unknown: true }).success, false)
})

test("acepta categoría opcional y rechaza identificadores vacíos", () => {
  assert.equal(tool.inputSchema.safeParse({ ...valid, categoryId: "categoria-gasto" }).success, true)
  assert.equal(tool.inputSchema.safeParse({ ...valid, categoryId: null }).success, true)
  assert.equal(tool.inputSchema.safeParse({ ...valid, categoryId: "" }).success, false)
})
