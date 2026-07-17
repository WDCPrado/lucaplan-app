// Corre con: node --test lib/import-progress.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { importStep, IMPORT_STEP_DWELL_MS } from "./import-progress.ts"

const [d0, d1] = IMPORT_STEP_DWELL_MS
const afterStep1 = d0 + d1

test("avanza por tiempo mientras la petición no responde", () => {
  assert.equal(importStep(0, false), 0)
  assert.equal(importStep(d0 - 1, false), 0)
  assert.equal(importStep(d0, false), 1)
  assert.equal(importStep(afterStep1 - 1, false), 1)
  assert.equal(importStep(afterStep1, false), 2) // categorizando
})

test("categorizando se queda hasta que responde (no salta a listo)", () => {
  assert.equal(importStep(afterStep1, false), 2)
  assert.equal(importStep(afterStep1 + 60_000, false), 2) // aunque pase mucho tiempo
  assert.equal(importStep(afterStep1, true), 3) // recién con respuesta → listo
})

test("respuesta instantánea NO adelanta los pasos: respeta el dwell mínimo", () => {
  // Aunque la petición ya respondió, los pasos 0 y 1 se muestran su tiempo mínimo.
  assert.equal(importStep(0, true), 0)
  assert.equal(importStep(d0 - 1, true), 0)
  assert.equal(importStep(d0, true), 1)
  assert.equal(importStep(afterStep1 - 1, true), 1)
  assert.equal(importStep(afterStep1, true), 3)
})
