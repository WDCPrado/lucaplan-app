// node --test arch/shared/mutex.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { withLock, withLockWaiting, LockBusyError } from "./mutex.ts"

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

test("withLockWaiting: espera al que tiene el lock y corre después, en orden", async () => {
  const order: string[] = []
  let release!: () => void
  const held = withLock("u3", () => new Promise<void>((r) => { release = () => { order.push("primero"); r() } }))
  const waiting = withLockWaiting("u3", async () => { order.push("segundo") })
  setTimeout(() => release(), 50)
  await Promise.all([held, waiting])
  assert.deepEqual(order, ["primero", "segundo"])
})

test("withLockWaiting: se rinde pasado el tope", async () => {
  let release!: () => void
  const held = withLock("u4", () => new Promise<void>((r) => { release = () => r() }))
  await assert.rejects(() => withLockWaiting("u4", async () => {}, 10), LockBusyError)
  release()
  await held
})
