import { test } from "node:test"
import assert from "node:assert/strict"
import { untransformedOrigin } from "./liquid-glass-box.ts"

test("sin transform, la caja visible es la caja", () => {
  const r = { left: 10, top: 20, width: 50, height: 30 }
  assert.deepEqual(untransformedOrigin(r, 50, 30), { x: 10, y: 20 })
})

test("la pastilla de Segmented en la segunda opción no se corre el doble", () => {
  // translateX(100%) de una pastilla de 50 px: se ve en 60, su caja está en 10.
  const r = { left: 60, top: 2, width: 50, height: 28 }
  const m = { a: 1, b: 0, c: 0, d: 1, e: 50, f: 0 }
  assert.deepEqual(untransformedOrigin(r, 50, 28, m), { x: 10, y: 2 })
})

test("un menú que escala desde su esquina superior izquierda", () => {
  // scale(0.5) con origen 0 0: caja en (100, 40) de 200×80, se ve 100×40 en la misma esquina.
  const r = { left: 100, top: 40, width: 100, height: 40 }
  const m = { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 }
  assert.deepEqual(untransformedOrigin(r, 200, 80, m, { x: 0, y: 0 }), {
    x: 100,
    y: 40,
  })
})
