import assert from "node:assert/strict"
import test from "node:test"
import { dueJobs, renewOutlook } from "./local-cron.mjs"

test("sincroniza cada cinco minutos sin repetir y recupera un tick atrasado", () => {
  assert.deepEqual(dueJobs(299_999, 240_000), [])
  assert.deepEqual(dueJobs(300_000, 299_999), ["scripts/sync-email.ts"])
  assert.deepEqual(dueJobs(360_000, 300_000), [])
  assert.deepEqual(dueJobs(900_000, 300_000), ["scripts/sync-email.ts"])
})

test("ejecuta los tres trabajos a medianoche UTC y no repite el diario", () => {
  const midnight = Date.parse("2026-10-31T00:00:00Z")
  assert.deepEqual(dueJobs(midnight, midnight - 60_000), [
    "scripts/sync-email.ts",
    "scripts/notify-due.ts",
    "renew-outlook",
  ])
  assert.deepEqual(dueJobs(midnight + 300_000, midnight), [
    "scripts/sync-email.ts",
  ])
})

test("renueva Outlook cada doce horas sin repetir recordatorios", () => {
  const noon = Date.parse("2026-10-31T12:00:00Z")
  assert.deepEqual(dueJobs(noon, noon - 60_000), [
    "scripts/sync-email.ts",
    "renew-outlook",
  ])
  assert.deepEqual(dueJobs(noon + 60_000, noon), [])
})

test("renueva contra el endpoint interno con Bearer y detecta fallos parciales", async () => {
  const secret = "test-renew-secret"
  await renewOutlook(secret, async (url, options) => {
    assert.equal(url, "http://app:3005/api/email-connection/renew")
    assert.equal(options?.method, "POST")
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      `Bearer ${secret}`
    )
    return Response.json({ checked: 1, renewed: 1, failed: 0 })
  })
  await assert.rejects(
    renewOutlook(secret, async () =>
      Response.json({ checked: 1, renewed: 0, failed: 1 })
    ),
    /buzones fallidos/
  )
})

test("errores de HTTP, red y JSON no incluyen secretos ni respuestas del proveedor", async () => {
  const secret = "must-not-appear"
  for (const request of [
    async () => new Response(secret, { status: 401 }),
    async () => {
      throw new Error(secret)
    },
    async () => new Response(secret),
  ]) {
    await assert.rejects(renewOutlook(secret, request), (error: Error) => {
      assert.equal(error.message.includes(secret), false)
      return true
    })
  }
  await assert.rejects(
    renewOutlook("", async () => {
      throw new Error("No debe llamar")
    }),
    /Falta OUTLOOK_RENEW_SECRET/
  )
})
