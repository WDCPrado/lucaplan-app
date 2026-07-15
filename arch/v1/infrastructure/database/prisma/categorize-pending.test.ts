import assert from "node:assert/strict"
import { test } from "node:test"
import { pendingCategorizationFilter } from "./categorize-pending-filter.ts"

test("la categorización pendiente excluye abonos y pagos internos", () => {
  assert.deepEqual(pendingCategorizationFilter("user-1"), {
    userId: "user-1",
    categoryId: null,
    status: "confirmed",
    isInternal: false,
  })
})
