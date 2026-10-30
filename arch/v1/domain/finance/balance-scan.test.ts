// Fórmulas de la lectura de saldos por captura. Corre con:
//   node --test arch/v1/domain/finance/balance-scan.test.ts
// Los casos con números reales salen de dos capturas de la app de Banco de Chile.
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "./money.ts"
import {
  EMPTY_BUCKET,
  BalanceScanError,
  limitMismatch,
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

// --- resolveBucket: el cupo guardado manda y despeja lo que la captura no trajo ---

// Caso real de la tarjeta Signature: la app del banco solo muestra el disponible.
test("solo disponible ⇒ usado = cupo guardado − disponible", () => {
  const r = resolveBucket(
    { limit: null, available: 1_334_697, used: null },
    Money.of(3_000_000, "CLP"),
    "CLP"
  )
  assert.equal(r?.used.toMajor(), 1_665_303)
  assert.equal(r?.limitAmount.toMajor(), 3_000_000)
})

test("solo usado ⇒ disponible = cupo guardado − usado", () => {
  const r = resolveBucket(
    { limit: null, available: null, used: 1_665_303 },
    Money.of(3_000_000, "CLP"),
    "CLP"
  )
  assert.equal(r?.available.toMajor(), 1_334_697)
  assert.equal(r?.limitAmount.toMajor(), 3_000_000)
})

// Con los dos leídos hay un grado de libertad de más: manda el disponible, que es el que la app del
// banco muestra siempre. El usado solo sirvió para comprobar (ver limitMismatch).
test("disponible y usado ⇒ manda el disponible y el usado se recalcula", () => {
  const r = resolveBucket(
    { limit: null, available: 1_334_697, used: 1_600_000 },
    Money.of(3_000_000, "CLP"),
    "CLP"
  )
  assert.equal(r?.used.toMajor(), 1_665_303)
  assert.equal(r?.limitAmount.toMajor(), 3_000_000)
})

test("el cupo que trae la imagen NO reemplaza al guardado", () => {
  const r = resolveBucket(
    { limit: 3_500_000, available: 1_334_697, used: null },
    Money.of(3_000_000, "CLP"),
    "CLP"
  )
  assert.equal(r?.limitAmount.toMajor(), 3_000_000)
  assert.equal(r?.used.toMajor(), 1_665_303)
})

// Única excepción: una cuenta que todavía no tiene cupo guardado. Ahí no hay nada que proteger.
test("sin cupo guardado, la captura lo estrena", () => {
  const suma = resolveBucket(
    { limit: null, available: 955_415, used: 25_650 },
    null,
    "CLP"
  )
  assert.equal(suma?.limitAmount.toMajor(), 981_065)
  const explicito = resolveBucket(
    { limit: 3_000_000, available: 1_334_697, used: null },
    Money.zero("CLP"),
    "CLP"
  )
  assert.equal(explicito?.limitAmount.toMajor(), 3_000_000)
  assert.equal(explicito?.used.toMajor(), 1_665_303)
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
  assert.equal(resolveBucket(EMPTY_BUCKET, Money.of(3_000_000, "CLP"), "CLP"), null)
  // Disponible sin cupo guardado NI cupo en la imagen: no hay de dónde sacar el total.
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

test("un utilizado mayor que el cupo es lectura mala ⇒ lanza", () => {
  assert.throws(
    () =>
      resolveBucket(
        { limit: null, available: null, used: 5_000_000 },
        Money.of(3_000_000, "CLP"),
        "CLP"
      ),
    BalanceScanError
  )
})

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

// --- limitMismatch: la captura contra el cupo total guardado ---

test("disponible + usado tienen que dar el cupo guardado", () => {
  // 1.334.697 + 1.665.303 = 3.000.000 exacto.
  assert.equal(
    limitMismatch(
      { limit: null, available: 1_334_697, used: 1_665_303 },
      Money.of(3_000_000, "CLP"),
      "CLP"
    ),
    null
  )
  // El mismo caso con un 8 en vez del 3: aritméticamente válido, pero ya no suma.
  const diff = limitMismatch(
    { limit: null, available: 1_834_697, used: 1_665_303 },
    Money.of(3_000_000, "CLP"),
    "CLP"
  )
  assert.equal(diff?.toMajor(), -500_000)
})

test("el cupo que muestra la captura tiene que ser el guardado", () => {
  assert.equal(
    limitMismatch(
      { limit: 3_000_000, available: 1_334_697, used: null },
      Money.of(3_000_000, "CLP"),
      "CLP"
    ),
    null
  )
  const diff = limitMismatch(
    { limit: 2_500_000, available: 1_334_697, used: null },
    Money.of(3_000_000, "CLP"),
    "CLP"
  )
  assert.equal(diff?.toMajor(), 500_000)
})

test("sin cupo guardado o sin nada que contrastar ⇒ null", () => {
  assert.equal(
    limitMismatch(
      { limit: null, available: 1_334_697, used: 1_665_303 },
      null,
      "CLP"
    ),
    null
  )
  assert.equal(
    limitMismatch(
      { limit: null, available: 1_334_697, used: null },
      Money.of(3_000_000, "CLP"),
      "CLP"
    ),
    null
  )
  assert.equal(limitMismatch(EMPTY_BUCKET, Money.of(3_000_000, "CLP"), "CLP"), null)
})

test("la comparación en dólares es exacta hasta el centavo", () => {
  assert.equal(
    limitMismatch(
      { limit: null, available: 2_069.55, used: 430.45 },
      Money.of(2_500, "USD"),
      "USD"
    ),
    null
  )
  const diff = limitMismatch(
    { limit: null, available: 2_069.55, used: 430.44 },
    Money.of(2_500, "USD"),
    "USD"
  )
  assert.equal(diff?.toDecimalString(), "0.01")
})

// --- resolveChecking: caja y línea desde el saldo ---

test("saldo negativo sin datos de línea conserva el saldo y no infiere deuda", () => {
  const r = resolveChecking(
    reading({ cash: -25_650, overdraft: EMPTY_BUCKET }),
    Money.of(1_000_000, "CLP")
  )
  assert.equal(r?.cash.toMajor(), -25_650)
  assert.equal(r?.overdraft, null)
})

// Captura real: "DISPONIBLE -$25.650" y "Línea disponible: $955.415". El disponible de la línea es
// un dato del banco independiente del saldo de la cuenta.
test("con la línea a la vista manda su disponible y el cupo guardado no se mueve", () => {
  const r = resolveChecking(
    reading({
      cash: -25_650,
      overdraft: { limit: null, available: 955_415, used: null },
    }),
    Money.of(1_000_000, "CLP")
  )
  assert.equal(r?.overdraft?.limitAmount.toMajor(), 1_000_000)
  assert.equal(r?.overdraft?.used.toMajor(), 44_585)
})

test("sin cupo de línea guardado, el saldo negativo no inventa un cupo", () => {
  const r = resolveChecking(
    reading({
      cash: -25_650,
      overdraft: { limit: null, available: 955_415, used: null },
    }),
    null
  )
  assert.equal(r?.cash.toMajor(), -25_650)
  assert.equal(r?.overdraft, null)
})

test("saldo positivo ⇒ es caja, y la línea sale del cupo guardado", () => {
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

