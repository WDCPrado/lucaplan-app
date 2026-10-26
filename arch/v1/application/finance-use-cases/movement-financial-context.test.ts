import test from "node:test"
import assert from "node:assert/strict"
import {
  movementFinancialContext,
  type MovementContextInput,
} from "./movement-financial-context.ts"

const input: MovementContextInput = {
  amount: 10000,
  currency: "CLP",
  direction: "debit",
  status: "confirmed",
  isInternal: false,
  accountType: "credit_card",
  externalId: "fake-email-reference",
  categoryType: "expense",
  categoryLimit: 50000,
  bucket: null,
  clpPerUsd: null,
}

test("CLP email is recorded national impact, not proof of final bank currency", () => {
  const result = movementFinancialContext(input)
  assert.equal(result.affectsCash, false)
  assert.equal(result.countsInBudget, true)
  assert.equal(result.financialContext.recordedImpact.target, "credit_national")
  assert.equal(result.financialContext.recordedImpact.bucketLink, null)
  assert.equal(
    result.financialContext.reconciliation.bankSettlementVerified,
    null
  )
  assert.equal(result.financialContext.reconciliation.originalBankAmount, null)
})

test("USD uses international credit and CLP conversion never changes recorded amount", () => {
  const result = movementFinancialContext({
    ...input,
    amount: 12.5,
    currency: "USD",
    clpPerUsd: 950,
    bucket: { kind: "credit_international", currency: "USD" },
  })
  assert.deepEqual(result.financialContext.recordedAmount, {
    amount: 12.5,
    currency: "USD",
  })
  assert.equal(
    result.financialContext.recordedImpact.target,
    "credit_international"
  )
  assert.equal(result.financialContext.budget.grossEquivalent, 11875)
  assert.equal(result.financialContext.budget.conversion, "reference_only")
  assert.equal(result.affectsCash, false)
})

test("mismatched bucket is disclosed instead of silently treated as reconciled", () => {
  const result = movementFinancialContext({
    ...input,
    bucket: { kind: "credit_international", currency: "USD" },
  })
  assert.equal(result.financialContext.recordedImpact.bucketConflict, true)
})

test("missing FX is unknown, never zero or invented rate", () => {
  const result = movementFinancialContext({ ...input, currency: "USD" })
  assert.equal(result.financialContext.budget.grossEquivalent, null)
  assert.equal(result.financialContext.budget.conversion, "unavailable")
})

for (const override of [
  { categoryLimit: 0 },
  { categoryType: null },
  { isInternal: true },
  { status: "pending" },
  { status: "reversed" },
  { status: "duplicated" },
  { direction: "credit", categoryType: "income" },
])
  test(`budget exclusion ${JSON.stringify(override)}`, () => {
    assert.equal(
      movementFinancialContext({ ...input, ...override }).countsInBudget,
      false
    )
  })

test("cash belongs to confirmed checking movements, not card payments", () => {
  assert.equal(
    movementFinancialContext({ ...input, accountType: "checking" }).affectsCash,
    true
  )
  assert.equal(
    movementFinancialContext({
      ...input,
      accountType: "checking",
      status: "pending",
    }).affectsCash,
    false
  )
  const payment = movementFinancialContext({
    ...input,
    direction: "credit",
    isInternal: true,
  })
  assert.equal(payment.affectsCash, false)
  assert.equal(
    payment.financialContext.recordedImpact.debtDirection,
    "decrease"
  )
})
