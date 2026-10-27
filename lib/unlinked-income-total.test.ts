import { strict as assert } from "node:assert"
import { test } from "node:test"
import { isUnlinkedIncome, unlinkedIncomeTotal } from "./unlinked-income-total.ts"

test("counts only confirmed independent CLP credits", () => {
  const credit = { direction: "credit", status: "confirmed", currency: "CLP", amount: 1745 }
  const rows = [
    credit,
    { ...credit, incomeId: "income-source" },
    { ...credit, status: "pending" },
    { ...credit, status: "reversed" },
    { ...credit, isInternal: true },
    { ...credit, recurringTemplateId: "recurring" },
    { ...credit, direction: "debit" },
    { ...credit, currency: "USD" },
  ]
  assert.equal(unlinkedIncomeTotal(rows), 1745)
  assert.equal(isUnlinkedIncome(credit), true)
  assert.equal(isUnlinkedIncome({ ...credit, incomeId: "income-source" }), false)
})
