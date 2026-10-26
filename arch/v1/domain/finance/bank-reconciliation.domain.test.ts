// Reglas únicas de la conciliación (WDC-123): qué movimiento admite corrección y qué aviso o fila
// de cartola es el mismo movimiento. Corre con:
// node --test arch/v1/domain/finance/bank-reconciliation.domain.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import {
  canReconcileCorrection,
  isSameBankMovement,
  normalizeMerchant,
  type BankMovementKey,
} from "./bank-reconciliation.domain.ts"

const gasto = {
  status: "confirmed",
  direction: "debit",
  isInternal: false,
  linked: false,
  recurringOnly: false,
  reimbursementAmount: 0,
}

test("la conciliación corrige importe o moneda de un gasto o abono confirmado suelto y de un cobro recurrente, nunca de uno con reembolso, no confirmado, interno o vinculado a ingreso o cuota", () => {
  assert.equal(canReconcileCorrection(gasto), true)
  assert.equal(canReconcileCorrection({ ...gasto, direction: "credit" }), true)
  assert.equal(
    canReconcileCorrection({ ...gasto, linked: true, recurringOnly: true }),
    true
  )
  // Reembolso: el borde es cualquier monto vinculado, por chico que sea.
  assert.equal(canReconcileCorrection({ ...gasto, reimbursementAmount: 1 }), false)
  assert.equal(
    canReconcileCorrection({ ...gasto, reimbursementAmount: 0.01 }),
    false
  )
  for (const status of ["pending", "reversed", "duplicated"])
    assert.equal(canReconcileCorrection({ ...gasto, status }), false, status)
  assert.equal(canReconcileCorrection({ ...gasto, isInternal: true }), false)
  // Vinculado a ingreso o cuota (no es solo recurrente).
  assert.equal(
    canReconcileCorrection({ ...gasto, linked: true, recurringOnly: false }),
    false
  )
  assert.equal(canReconcileCorrection({ ...gasto, linked: true }), false)
  // Supuesto: un abono recurrente no es un «cobro» recurrente y no se liquida.
  assert.equal(
    canReconcileCorrection({
      ...gasto,
      direction: "credit",
      linked: true,
      recurringOnly: true,
    }),
    false
  )
})

const aviso: BankMovementKey = {
  date: "2026-10-10",
  direction: "debit",
  amount: 12990,
  currency: "CLP",
  description: "Líder Express #12",
}
const otro = (over: Partial<BankMovementKey>): BankMovementKey => ({
  ...aviso,
  description: "OTRO COMERCIO",
  ...over,
})

test("dos movimientos son el mismo solo si van en la misma dirección y a no más de 4 días; un día más ya no", () => {
  const amount = { days: 4, match: "amount" } as const
  assert.equal(isSameBankMovement(aviso, otro({ date: "2026-10-10" }), amount), true)
  assert.equal(isSameBankMovement(aviso, otro({ date: "2026-10-14" }), amount), true)
  assert.equal(isSameBankMovement(aviso, otro({ date: "2026-10-06" }), amount), true)
  assert.equal(isSameBankMovement(aviso, otro({ date: "2026-10-15" }), amount), false)
  assert.equal(isSameBankMovement(aviso, otro({ date: "2026-10-05" }), amount), false)
  // Cruce de mes: 30-09 contra 03-10 son 3 días.
  assert.equal(
    isSameBankMovement(
      { ...aviso, date: "2026-09-30" },
      otro({ date: "2026-10-03" }),
      amount
    ),
    true
  )
  // Dirección distinta nunca es el mismo, en ningún modo y aunque todo lo demás coincida.
  for (const match of ["amount", "amountOrDescription", "amountAndDescription"] as const)
    assert.equal(
      isSameBankMovement(aviso, { ...aviso, direction: "credit" }, { days: 4, match }),
      false,
      match
    )
})

test("cartola contra registrados compara importe y moneda; candidato a duplicado acepta importe o comercio; enlace de aviso exige los dos", () => {
  const mismoImporte = otro({})
  const mismoComercio = { ...aviso, amount: 5000, description: "LIDER EXPRESS 12" }
  const comercioEnDolares = { ...aviso, amount: 13.5, currency: "USD", description: "LIDER EXPRESS 12" }
  const mismoNumeroOtraMoneda = otro({ currency: "USD" })
  const nada = otro({ amount: 5000 })
  const ambos = { ...aviso, description: "LIDER EXPRESS 12" }
  const by = (match: "amount" | "amountOrDescription" | "amountAndDescription") =>
    (b: BankMovementKey) => isSameBankMovement(aviso, b, { days: 4, match })

  const amount = by("amount")
  assert.equal(amount(mismoImporte), true)
  assert.equal(amount(mismoComercio), false)
  assert.equal(amount(mismoNumeroOtraMoneda), false)

  const any = by("amountOrDescription")
  assert.equal(any(mismoImporte), true)
  assert.equal(any(mismoComercio), true)
  assert.equal(any(comercioEnDolares), true) // conservador: otra moneda del mismo comercio es candidato
  assert.equal(any(mismoNumeroOtraMoneda), false)
  assert.equal(any(nada), false)

  const both = by("amountAndDescription")
  assert.equal(both(ambos), true)
  assert.equal(both(mismoImporte), false)
  assert.equal(both(mismoComercio), false)
})

test("el comercio se compara sin mayúsculas, signos ni tildes: «Líder Express #12» es «LIDER EXPRESS 12»", () => {
  assert.equal(normalizeMerchant("Líder Express #12"), "LIDEREXPRESS12")
  assert.equal(normalizeMerchant("LIDER EXPRESS 12"), "LIDEREXPRESS12")
  assert.equal(normalizeMerchant("lider-express  12."), "LIDEREXPRESS12")
  // Borde: la tilde se quita, la letra se queda (hoy `[^A-Z0-9]` borra la «Í» entera → «LDEREXPRESS12»).
  assert.equal(normalizeMerchant("Ñuñoa Café"), "NUNOACAFE")
  // Un nombre más corto no es el mismo comercio.
  assert.notEqual(normalizeMerchant("Lider"), normalizeMerchant("Lider Express"))
})
