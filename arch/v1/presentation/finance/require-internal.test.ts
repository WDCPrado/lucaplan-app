// Corre con: node --test arch/v1/presentation/finance/require-internal.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { CRON_KEY_HEADER, isInternalRequest } from "./require-internal.ts"

const KEY = "secreto-del-proyecto"
const headers = (init: Record<string, string> = {}) => new Headers(init)

test("pasa: red privada con el secreto correcto", () => {
  assert.equal(
    isInternalRequest(headers({ [CRON_KEY_HEADER]: KEY }), KEY),
    true
  )
})

test("rechaza: vino del edge público aunque traiga el secreto", () => {
  for (const h of [
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
    "cf-connecting-ip",
  ]) {
    assert.equal(
      isInternalRequest(headers({ [CRON_KEY_HEADER]: KEY, [h]: "1.2.3.4" }), KEY),
      false,
      `debería rechazar con ${h}`
    )
  }
})

test("rechaza: red privada sin el secreto o con uno incorrecto", () => {
  assert.equal(isInternalRequest(headers(), KEY), false)
  assert.equal(
    isInternalRequest(headers({ [CRON_KEY_HEADER]: "otra" }), KEY),
    false
  )
})

test("fail-closed: sin CRON_KEY configurada no pasa nadie", () => {
  assert.equal(isInternalRequest(headers({ [CRON_KEY_HEADER]: KEY }), ""), false)
  assert.equal(
    isInternalRequest(headers({ [CRON_KEY_HEADER]: KEY }), undefined),
    false
  )
})
