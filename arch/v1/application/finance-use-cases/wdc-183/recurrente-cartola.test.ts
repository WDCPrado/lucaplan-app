// WDC-183 · Recurrente: «vino del banco» = origin email o statement (antes, externalId ≠ null). Un
// alta de la cartola no trae externalId y tiene que poder vincularse como cobro de una recurrente.
// Corre con: node --test arch/v1/application/finance-use-cases/wdc-183/recurrente-cartola.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../../domain/finance/money.ts"
import type { Transaction } from "../../../domain/finance/finance.domain.ts"
import {
  paymentCandidateRejection,
  type RecurringTemplate,
} from "../../../domain/finance/recurring.domain.ts"

const arriendo: RecurringTemplate = {
  id: "arriendo",
  userId: "u1",
  accountId: "corriente",
  categoryId: "vivienda",
  label: "Arriendo depto",
  description: "ARRIENDO DEPTO",
  direction: "debit",
  baseAmount: Money.of(350_000, "CLP"),
  currency: "CLP",
  tolerancePct: 10,
  periodicity: "monthly",
  dayOfMonth: 5,
  startDate: new Date(Date.UTC(2026, 6, 5)),
  endDate: null,
  isActive: true,
  url: null,
}

const cargo = (over: Partial<Transaction>): Transaction => ({
  id: "t1",
  userId: "u1",
  accountId: "corriente",
  categoryId: "vivienda",
  date: new Date("2026-11-05T00:00:00Z"),
  description: "ARRIENDO DEPTO",
  amount: Money.of(350_000, "CLP"),
  direction: "debit",
  status: "confirmed",
  isInternal: false,
  externalId: null,
  ...over,
})

test("el cargo del arriendo dado de alta desde la cartola (sin aviso de correo) se puede vincular como pago de la recurrente; uno sin origen bancario no", () => {
  assert.equal(paymentCandidateRejection(cargo({ origin: "statement" }), arriendo, "2026-11"), null)
  assert.equal(paymentCandidateRejection(cargo({ origin: "email", externalId: "msg-1" }), arriendo, "2026-11"), null)
  assert.match(
    paymentCandidateRejection(cargo({ origin: "legacy" }), arriendo, "2026-11") ?? "",
    /banco/
  )
  // El comprometido que crea la propia recurrente tampoco es un cobro del banco.
  assert.match(
    paymentCandidateRejection(cargo({ origin: "system" }), arriendo, "2026-11") ?? "",
    /banco/
  )
})
