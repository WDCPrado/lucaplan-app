import assert from "node:assert/strict"
import { test } from "node:test"
import { createRateWindow } from "./rate-window.ts"

test("deja pasar hasta el límite por clave, se libera al vencer la ventana y borra las claves vencidas", () => {
  const w = createRateWindow(2, 1000)
  assert.equal(w.take("a", 0), true)
  assert.equal(w.take("a", 10), true)
  assert.equal(w.take("a", 20), false) // tercera dentro de la ventana
  assert.equal(w.take("b", 20), true) // otra clave no se ve afectada
  assert.equal(w.take("a", 1005), true) // venció la primera
  assert.equal(w.take("c", 5000), true)
  assert.equal(w.size(), 1) // a y b vencieron y se borraron
})
