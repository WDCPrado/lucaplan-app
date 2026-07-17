// node --test arch/shared/mutex.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { withLock, LockBusyError } from "./mutex.ts"

test("withLock: una segunda toma concurrente de la misma clave falla", async () => {
  let release!: () => void
  const held = withLock(
    "u1",
    () =>
      new Promise<void>((r) => {
        release = () => r()
      })
  )
  await assert.rejects(() => withLock("u1", async () => {}), LockBusyError)
  release()
  await held
  // Tras liberar, se puede volver a tomar.
  await withLock("u1", async () => {})
})

test("withLock: claves distintas no se bloquean entre sí", async () => {
  let release!: () => void
  const held = withLock(
    "u1",
    () =>
      new Promise<void>((r) => {
        release = () => r()
      })
  )
  await withLock("u2", async () => {}) // otra clave: no bloquea
  release()
  await held
})
