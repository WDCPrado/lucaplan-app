// Fórmulas de la lectura de saldos por captura. Corre con:
//   node --test arch/v1/domain/finance/balance-scan.test.ts
// Los casos con números reales salen de dos capturas de la app de Banco de Chile.
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "./money.ts"
import {
  EMPTY_BUCKET,
  BalanceScanError,
  bucketMismatch,
  resolveBucket,
  resolveChecking,
  type BalanceReading,
} from "./balance-scan.domain.ts"

const reading = (over: Partial<BalanceReading> = {}): BalanceReading => ({
  last4: null,
  cash: null,
  overdraft: EMPTY_BUCKET,
  national: EMPTY_BUCKET,
  international: EMPTY_BUCKET,
  ...over,
})

// --- resolveBucket: la escalera según lo que traiga la imagen ---

test("cupo + disponible en la imagen ⇒ usado = cupo − disponible", () => {
  const r = resolveBucket(
    { limit: 3_000_000, available: 1_334_697, used: null },
    null,
    "CLP"
  )
  assert.equal(r?.used.toMajor(), 1_665_303)
  assert.equal(r?.limitAmount.toMajor(), 3_000_000)
})

test("cupo + usado en la imagen ⇒ disponible = cupo − usado", () => {
  const r = resolveBucket(
    { limit: 3_000_000, available: null, used: 1_665_303 },
    null,
    "CLP"
  )
  assert.equal(r?.available.toMajor(), 1_334_697)
})

test("disponible + usado sin cupo ⇒ el cupo total sale de la suma", () => {
  const r = resolveBucket(
    { limit: null, available: 955_415, used: 25_650 },
    null,
    "CLP"
  )
  assert.equal(r?.limitAmount.toMajor(), 981_065)
})

// Caso real de la tarjeta Signature: la app del banco solo muestra el disponible.
test("solo disponible ⇒ completa con el cupo ya guardado", () => {
  const r = resolveBucket(
    { limit: null, available: 1_334_697, used: null },
    Money.of(3_000_000, "CLP"),
    "CLP"
  )
  assert.equal(r?.used.toMajor(), 1_665_303)
  assert.equal(r?.limitAmount.toMajor(), 3_000_000)
})

test("solo usado ⇒ completa con el cupo ya guardado", () => {
  const r = resolveBucket(
    { limit: null, available: null, used: 1_665_303 },
    Money.of(3_000_000, "CLP"),
    "CLP"
  )
  assert.equal(r?.available.toMajor(), 1_334_697)
})

test("el cupo de la imagen le gana al guardado (el guardado puede estar viejo)", () => {
  const r = resolveBucket(
    { limit: 3_500_000, available: 1_334_697, used: null },
    Money.of(3_000_000, "CLP"),
    "CLP"
  )
  assert.equal(r?.limitAmount.toMajor(), 3_500_000)
})

test("USD conserva los decimales del cupo internacional", () => {
  const r = resolveBucket(
    { limit: null, available: 2_069, used: null },
    Money.of(2_500, "USD"),
    "USD"
  )
  assert.equal(r?.used.toMajor(), 431)
  assert.equal(r?.used.toDecimalString(), "431.00")
})

test("sin datos suficientes ⇒ null (el bucket no se toca)", () => {
  assert.equal(resolveBucket(EMPTY_BUCKET, null, "CLP"), null)
  // Disponible sin cupo en la imagen NI guardado: no hay de dónde sacar el total.
  assert.equal(
    resolveBucket({ limit: null, available: 1000, used: null }, null, "CLP"),
    null
  )
})

test("un disponible mayor que el cupo es lectura mala ⇒ lanza", () => {
  assert.throws(
    () =>
      resolveBucket(
        { limit: null, available: 5_000_000, used: null },
        Money.of(3_000_000, "CLP"),
        "CLP"
      ),
    BalanceScanError
  )
})

// --- Coherencia: el separador de miles y la suma de los tres valores ---

// El error de lectura más caro: "$1.334.697" interpretado como decimal da 1,334697, que en pesos
// Money redondearía a $1 y ninguna otra validación notaría.
test("un monto en pesos con decimales se rechaza como lectura mala", () => {
  assert.throws(
    () =>
      resolveBucket(
        { limit: null, available: 1.334697, used: null },
        Money.of(3_000_000, "CLP"),
        "CLP"
      ),
    BalanceScanError
  )
})

test("en dólares los dos decimales son legítimos", () => {
  const r = resolveBucket(
    { limit: null, available: 2_069.55, used: null },
    Money.of(2_500, "USD"),
    "USD"
  )
  assert.equal(r?.available.toDecimalString(), "2069.55")
  assert.equal(r?.used.toDecimalString(), "430.45")
})

test("más decimales de los que la moneda admite se rechazan", () => {
  assert.throws(
    () =>
      resolveBucket(
        { limit: null, available: 2_069.5551, used: null },
        Money.of(2_500, "USD"),
        "USD"
      ),
    BalanceScanError
  )
})

test("con los tres valores, la suma que no cuadra delata un dígito mal leído", () => {
  // 1.334.697 + 1.665.303 = 3.000.000 exacto.
  assert.equal(
    bucketMismatch(
      { limit: 3_000_000, available: 1_334_697, used: 1_665_303 },
      "CLP"
    ),
    null
  )
  // El mismo caso con un 8 en vez del 3: aritméticamente válido, pero ya no suma.
  const diff = bucketMismatch(
    { limit: 3_000_000, available: 1_834_697, used: 1_665_303 },
    "CLP"
  )
  assert.equal(diff?.toMajor(), -500_000)
})

test("sin los tres valores no hay con qué contrastar ⇒ null", () => {
  assert.equal(
    bucketMismatch({ limit: 3_000_000, available: 1_334_697, used: null }, "CLP"),
    null
  )
  assert.equal(bucketMismatch(EMPTY_BUCKET, "CLP"), null)
})

test("la comparación en dólares es exacta hasta el centavo", () => {
  assert.equal(
    bucketMismatch({ limit: 2_500, available: 2_069.55, used: 430.45 }, "USD"),
    null
  )
  const diff = bucketMismatch(
    { limit: 2_500, available: 2_069.55, used: 430.44 },
    "USD"
  )
  assert.equal(diff?.toDecimalString(), "0.01")
})

// --- resolveChecking: caja y línea desde el saldo ---

// Captura real: "DISPONIBLE -$25.650" y "Línea disponible: $955.415", sin cupo total a la vista.
test("saldo negativo ⇒ caja en cero, la deuda es de la línea y el cupo se deriva", () => {
  const r = resolveChecking(
    reading({
      cash: -25_650,
      overdraft: { limit: null, available: 955_415, used: null },
    }),
    null
  )
  assert.equal(r?.cash.toMajor(), 0)
  assert.equal(r?.overdraft?.used.toMajor(), 25_650)
  assert.equal(r?.overdraft?.available.toMajor(), 955_415)
  assert.equal(r?.overdraft?.limitAmount.toMajor(), 981_065)
})

test("saldo positivo ⇒ es caja, y la línea se completa con el cupo guardado", () => {
  const r = resolveChecking(
    reading({
      cash: 842_350,
      overdraft: { limit: null, available: 900_000, used: null },
    }),
    Money.of(1_000_000, "CLP")
  )
  assert.equal(r?.cash.toMajor(), 842_350)
  assert.equal(r?.overdraft?.used.toMajor(), 100_000)
})

test("saldo sin línea a la vista ⇒ actualiza la caja y deja la línea intacta", () => {
  const r = resolveChecking(reading({ cash: 500_000 }), Money.of(1_000_000, "CLP"))
  assert.equal(r?.cash.toMajor(), 500_000)
  assert.equal(r?.overdraft, null)
})

test("sin saldo en la imagen ⇒ null (no se toca la cuenta)", () => {
  assert.equal(resolveChecking(reading({ cash: null }), null), null)
})

test("el usado explícito de la imagen le gana al derivado del saldo negativo", () => {
  const r = resolveChecking(
    reading({
      cash: -25_650,
      overdraft: { limit: 1_000_000, available: null, used: 44_585 },
    }),
    null
  )
  assert.equal(r?.overdraft?.used.toMajor(), 44_585)
  assert.equal(r?.overdraft?.available.toMajor(), 955_415)
})
