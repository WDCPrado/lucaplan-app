import assert from "node:assert/strict"
import test from "node:test"
import { spawnSync } from "node:child_process"
import { dueJobs, renewOutlook } from "./local-cron.mjs"

test("renovación one-shot usa localhost y termina con error cuando falta secreto", async () => {
  await renewOutlook("secret", async (url) => {
    assert.equal(url, "http://127.0.0.1:3005/api/email-connection/renew")
    return Response.json({ failed: 0 })
  }, "http://127.0.0.1:3005")
  const result = spawnSync(process.execPath, ["scripts/local-cron.mjs", "--renew-once"], {
    env: { ...process.env, OUTLOOK_RENEW_SECRET: "" }, encoding: "utf8", timeout: 5_000,
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Falta OUTLOOK_RENEW_SECRET/)
})

test("no sondea correo cada cinco minutos ni al recuperar un tick atrasado", () => {
  assert.deepEqual(dueJobs(299_999, 240_000), [])
  assert.deepEqual(dueJobs(300_000, 299_999), [])
  assert.deepEqual(dueJobs(360_000, 300_000), [])
  assert.deepEqual(dueJobs(900_000, 300_000), [])
})

test("ejecuta recordatorios y renovación a medianoche UTC y no repite el diario", () => {
  const midnight = Date.parse("2026-10-31T00:00:00Z")
  assert.deepEqual(dueJobs(midnight, midnight - 60_000), [
    "scripts/notify-due.ts",
    "renew-outlook",
  ])
  assert.deepEqual(dueJobs(midnight + 300_000, midnight), [])
})

test("renueva Outlook cada doce horas sin repetir recordatorios", () => {
  const noon = Date.parse("2026-10-31T12:00:00Z")
  assert.deepEqual(dueJobs(noon, noon - 60_000), [
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
