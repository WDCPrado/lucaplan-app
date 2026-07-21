// Normalización + match por prefijo de monto. Corre con: node --test arch/v1/domain/finance/amount-search.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { amountDigits, amountPrefixRanges } from "./amount-search.ts"

const matches = (digits: string, n: number) =>
  amountPrefixRanges(digits).some((r) => n >= r.gte && n < r.lt)

test("amountDigits ignora separadores y símbolos", () => {
  assert.equal(amountDigits("12.990"), "12990")
  assert.equal(amountDigits("$12,990"), "12990")
  assert.equal(amountDigits("12990"), "12990")
  assert.equal(amountDigits("café"), "")
})

test("prefijo: 1299 matchea 1299, 12990, 12991, 12999, 129900", () => {
  for (const n of [1299, 12990, 12991, 12999, 129900])
    assert.ok(matches("1299", n), `${n} debería matchear 1299`)
})

test("prefijo: 1299 NO matchea 1300, 130 ni 129", () => {
  assert.ok(!matches("1299", 1300))
  assert.ok(!matches("1299", 130))
  assert.ok(!matches("1299", 129))
})

test("prefijo con y sin separadores son equivalentes", () => {
  assert.deepEqual(
    amountPrefixRanges(amountDigits("12.990")),
    amountPrefixRanges("12990")
  )
})

test("sin dígitos o con ceros a la izquierda → sin rangos", () => {
  assert.deepEqual(amountPrefixRanges(""), [])
  assert.deepEqual(amountPrefixRanges("012"), [])
})
