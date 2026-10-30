import assert from "node:assert/strict"
import test from "node:test"
import { dueJobs } from "./local-cron.mjs"

test("sincroniza cada cinco minutos sin repetir y recupera un tick atrasado", () => {
  assert.deepEqual(dueJobs(299_999, 240_000), [])
  assert.deepEqual(dueJobs(300_000, 299_999), ["scripts/sync-email.ts"])
  assert.deepEqual(dueJobs(360_000, 300_000), [])
  assert.deepEqual(dueJobs(900_000, 300_000), ["scripts/sync-email.ts"])
})

test("ejecuta ambos trabajos al cruzar medianoche UTC y no repite el diario", () => {
  const midnight = Date.parse("2026-10-31T00:00:00Z")
  assert.deepEqual(dueJobs(midnight, midnight - 60_000), [
    "scripts/sync-email.ts",
    "scripts/notify-due.ts",
  ])
  assert.deepEqual(dueJobs(midnight + 300_000, midnight), ["scripts/sync-email.ts"])
})
