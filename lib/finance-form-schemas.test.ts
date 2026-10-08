import assert from "node:assert/strict"
import test from "node:test"
import {
  accountSchema,
  categoryLimitSchema,
  categorySchema,
  incomeSchema,
  monthlyBudgetSchema,
  transactionEditFormSchema,
  transactionSchema,
  transactionUpdateSchema,
} from "./finance-form-schemas.ts"

test("presupuesto global exige entero no negativo; categoría conserva el redondeo del dominio", () => {
  const period = { year: 2026, month: 10 }
  assert.equal(
    monthlyBudgetSchema.safeParse({ ...period, globalLimit: 0 }).success,
    true
  )
  for (const globalLimit of [-1, 1.5, NaN, Infinity]) {
    assert.equal(
      monthlyBudgetSchema.safeParse({ ...period, globalLimit }).success,
      false
    )
  }
  const input = { ...period, categoryId: "category", limit: -1.5 }
  assert.deepEqual(categoryLimitSchema.parse(input), input)
})

test("cuenta mantiene saldo negativo y tarjeta con últimos cuatro normalizables", () => {
  const input = {
    bankName: "Mi banco",
    name: "Corriente",
    accountType: "checking" as const,
    currency: "CLP" as const,
    balance: -100000,
    color: null,
    cardLast4: "**** 1234",
  }
  assert.deepEqual(accountSchema.parse(input), input)
  for (const name of ["", "   "]) {
    assert.equal(accountSchema.safeParse({ ...input, name }).success, false)
  }
  assert.equal(
    accountSchema.safeParse({ ...input, bankName: "   " }).success,
    false
  )
  const longName = "  " + "Cuenta extensa ".repeat(100) + "  "
  assert.equal(accountSchema.parse({ ...input, name: longName }).name, longName)
  assert.equal(
    accountSchema.safeParse({ ...input, cardLast4: "123" }).success,
    false
  )
  assert.equal(
    accountSchema.safeParse({
      ...input,
      accountType: "wallet",
      cardLast4: null,
    }).success,
    true
  )
})

test("categoría conserva metadatos nullable, omisión de pace y nombre sin límite inventado", () => {
  const input = {
    name: "  " + "Categoría extensa ".repeat(100) + "  ",
    type: "expense" as const,
    icon: null,
    color: null,
    description: null,
  }
  assert.deepEqual(categorySchema.parse(input), input)
  assert.equal("paceEnabled" in categorySchema.parse(input), false)
  for (const name of ["", "   "]) {
    assert.equal(categorySchema.safeParse({ ...input, name }).success, false)
  }
})

test("ingreso rechaza nombre vacío y monto cero; permite día31 y decimales existentes", () => {
  const input = {
    accountId: "account",
    categoryId: "income",
    name: "Sueldo",
    amount: 1.25,
    dayOfMonth: 31,
  }
  assert.deepEqual(incomeSchema.parse(input), input)
  for (const patch of [
    { name: "  " },
    { amount: 0 },
    { dayOfMonth: 0 },
    { dayOfMonth: 1.5 },
    { dayOfMonth: 32 },
  ]) {
    assert.equal(incomeSchema.safeParse({ ...input, ...patch }).success, false)
  }
})

test("movimiento no transforma categoría vacía y distingue alta positiva de edición con cero", () => {
  const fields = {
    categoryId: "",
    description: "Movimiento",
    date: "2026-10-07",
    direction: "debit" as const,
  }
  assert.deepEqual(transactionUpdateSchema.parse({ ...fields, amount: 0 }), {
    ...fields,
    amount: 0,
  })
  assert.equal(
    transactionUpdateSchema.safeParse({ ...fields, amount: -100 }).success,
    true
  )
  assert.equal(
    transactionSchema.safeParse({
      ...fields,
      accountId: "account",
      currency: "CLP",
      amount: 0,
    }).success,
    false
  )
  assert.equal(
    transactionSchema.safeParse({
      ...fields,
      accountId: "account",
      currency: "USD",
      amount: 1.25,
    }).success,
    true
  )
  assert.equal(
    transactionUpdateSchema.safeParse({
      ...fields,
      amount: 1,
      date: "invalida",
    }).success,
    false
  )
})

test("edición manual exige monto positivo y descripción; el contrato HTTP conserva movimientos históricos", () => {
  const input = {
    categoryId: "",
    description: "Compra",
    date: "2026-10-07",
    direction: "debit" as const,
    amount: 1000,
  }
  assert.equal(transactionEditFormSchema.safeParse(input).success, true)
  for (const amount of [0, -1000]) {
    assert.equal(
      transactionEditFormSchema.safeParse({ ...input, amount }).success,
      false
    )
    assert.equal(
      transactionUpdateSchema.safeParse({ ...input, amount }).success,
      true
    )
  }
  assert.equal(
    transactionEditFormSchema.safeParse({ ...input, description: "   " })
      .success,
    false
  )
})
