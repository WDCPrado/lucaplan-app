// Corre con: node --test arch/v1/domain/finance/money.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "./money.ts"

test("Money: CLP sin decimales, USD con 2", () => {
  assert.equal(Money.of(19005, "CLP").minor, BigInt(19005))
  assert.equal(Money.of("19.10", "USD").minor, BigInt(1910))
  assert.equal(Money.of(19.1, "USD").minor, BigInt(1910))
})

test("Money: suma misma moneda", () => {
  const total = Money.of(1000, "CLP").add(Money.of(500, "CLP"))
  assert.equal(total.toMajor(), 1500)
})

test("Money: mezclar CLP + USD lanza error", () => {
  assert.throws(
    () => Money.of(1000, "CLP").add(Money.of(1, "USD")),
    /distinta moneda/
  )
})

test("Money: signo y cero", () => {
  assert.equal(Money.of(-100000, "CLP").isNegative, true)
  assert.equal(Money.of(0, "CLP").isZero, true)
  assert.equal(Money.of(1, "CLP").isPositive, true)
})
