import assert from "node:assert/strict"
import { test } from "node:test"
import { pendingCategorizationFilter } from "./categorize-pending-filter.ts"

// Sin filtro de fecha, y es a propósito: el reintento manual de la categorización tiene que
// alcanzar lo que quedó pendiente en meses anteriores, no solo el mes en vista.
test("la categorización pendiente excluye internos, lo ya revisado por el usuario y lo vinculado a una recurrente o cuota", () => {
  assert.deepEqual(pendingCategorizationFilter("user-1"), {
    userId: "user-1",
    categoryId: null,
    status: "confirmed",
    isInternal: false,
    reviewed: false,
    recurringTemplateId: null,
    installmentItemId: null,
  })
})
