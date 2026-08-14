import assert from "node:assert/strict"
import { test } from "node:test"
import { pendingCategorizationFilter } from "./categorize-pending-filter.ts"

// Sin filtro de fecha, y es a propósito: el reintento manual de la categorización tiene que
// alcanzar lo que quedó pendiente en meses anteriores, no solo el mes en vista.
test("la categorización pendiente excluye internos y lo ya revisado por el usuario", () => {
  assert.deepEqual(pendingCategorizationFilter("user-1"), {
    userId: "user-1",
    categoryId: null,
    status: "confirmed",
    isInternal: false,
    reviewed: false,
  })
})
