import test from "node:test"
import assert from "node:assert/strict"
import { reconcileBankRows } from "./bank-reconciliation.ts"

test("same amount and nearby date matches despite different descriptions", () => {
  const result = reconcileBankRows([{date:"2026-10-22",description:"BANK",amount:1490,direction:"debit"}],
    [{id:"a",date:"2026-10-21",description:"EMAIL",amount:1490,direction:"debit"}])
  assert.equal(result[0].status,"matched")
})
test("identical bank rows never consume the same existing movement twice", () => {
  const bank = Array.from({length:2},()=>({date:"2026-10-22",description:"LIME",amount:1000,direction:"debit" as const}))
  const result = reconcileBankRows(bank,[{id:"a",date:"2026-10-22",description:"LIME",amount:1000,direction:"debit"}])
  assert.deepEqual(result.map(x=>x.status),["matched","missing"])
})
test("multiple candidates are ambiguous and remain unconsumed", () => {
  const result=reconcileBankRows([{date:"2026-10-22",description:"A",amount:1000,direction:"debit"}],
  [{id:"a",date:"2026-10-22",description:"X",amount:1000,direction:"debit"},{id:"b",date:"2026-10-22",description:"Y",amount:1000,direction:"debit"}])
  assert.equal(result[0].status,"ambiguous")
})
