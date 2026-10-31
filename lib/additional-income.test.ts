import { strict as assert } from "node:assert"
import { test } from "node:test"
import { isAdditionalIncome } from "./additional-income.ts"

test("cuenta abonos confirmados salvo que su fuente ya esté incluida en el plan", () => {
  const credit = { direction: "credit", status: "confirmed" }
  const included = new Set(["income-source"])
  assert.equal(isAdditionalIncome(credit, included), true)
  assert.equal(isAdditionalIncome({ ...credit, incomeId: "absent-source" }, included), true)
  for (const excluded of [
    { ...credit, incomeId: "income-source" },
    { ...credit, status: "pending" },
    { ...credit, status: "reversed" },
    { ...credit, isInternal: true },
    { ...credit, recurringTemplateId: "recurring" },
    { ...credit, installmentItemId: "installment" },
    { ...credit, installmentForecast: true },
    { ...credit, direction: "debit" },
    { ...credit, status: "duplicated" },
  ]) assert.equal(isAdditionalIncome(excluded, included), false)
})
