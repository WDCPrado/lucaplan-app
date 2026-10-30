// Forma de los mapas del Liquid Glass. Corre con: node --test lib/liquid-refraction.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { glassMaps } from "./liquid-refraction.ts"

const W = 61
const H = 21
const { displacement, specular, maxDisplacement } = glassMaps(W, H, 10.5, 6)
const px = (data: Uint8ClampedArray, x: number, y: number) => data.slice((y * W + x) * 4, (y * W + x) * 4 + 4)

test("un píxel RGBA por punto del elemento", () => {
  assert.equal(displacement.length, W * H * 4)
  assert.equal(specular.length, W * H * 4)
  assert.ok(maxDisplacement > 0)
})

test("el interior plano no desplaza: canal neutro 128", () => {
  assert.deepEqual([...px(displacement, 30, 10)], [128, 128, 128, 255])
  assert.equal(px(specular, 30, 10)[3], 0)
})

test("el canto desplaza hacia el centro y es simétrico", () => {
  const left = px(displacement, 2, 10)
  const right = px(displacement, W - 3, 10)
  assert.ok(left[0] > 128, "a la izquierda muestrea hacia la derecha")
  assert.equal(left[0] + right[0], 256)
  const top = px(displacement, 30, 2)
  const bottom = px(displacement, 30, H - 3)
  assert.ok(top[1] > 128, "arriba muestrea hacia abajo")
  assert.equal(top[1] + bottom[1], 256)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      assert.equal(px(displacement, x, y)[0] + px(displacement, W - 1 - x, y)[0], 256)
      assert.equal(px(displacement, x, y)[1] + px(displacement, x, H - 1 - y)[1], 256)
    }
})

test("el brillo es más fuerte en el canto de arriba-izquierda que en el opuesto", () => {
  const topLeft = px(specular, 3, 3)[3]
  const bottomRight = px(specular, W - 4, H - 4)[3]
  assert.ok(topLeft > bottomRight && bottomRight > 0)
})
