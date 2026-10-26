import { Money } from "../../domain/finance/money.ts"
import { toClp } from "../../domain/finance/exchange.domain.ts"

export type MovementContextInput = {
  amount: number
  currency: string
  direction: string
  status: string
  isInternal: boolean
  accountType: string
  externalId: string | null
  categoryType: string | null
  categoryLimit: number
  bucket: { kind: string; currency: string } | null
  clpPerUsd: number | null
}

/** Describes the recorded ledger, never claims that an email proves final bank settlement. */
export function movementFinancialContext(input: MovementContextInput) {
  const confirmed = input.status === "confirmed"
  const card = input.accountType === "credit_card"
  const inferredBucket = card
    ? input.currency === "USD"
      ? "credit_international"
      : input.currency === "CLP"
        ? "credit_national"
        : null
    : input.accountType === "checking"
      ? "cash"
      : null
  const bucketConflict =
    !!input.bucket &&
    (input.bucket.currency !== input.currency ||
      (card && input.bucket.kind !== inferredBucket))
  const countsInBudget =
    confirmed &&
    !input.isInternal &&
    input.direction === "debit" &&
    input.categoryType === "expense" &&
    input.categoryLimit > 0
  const rate =
    input.clpPerUsd !== null &&
    Number.isFinite(input.clpPerUsd) &&
    input.clpPerUsd > 0
      ? input.clpPerUsd
      : null
  const budgetAmount =
    input.currency === "CLP"
      ? input.amount
      : input.currency === "USD" && rate !== null
        ? toClp(Money.of(input.amount, "USD"), rate).toMajor()
        : null
  return {
    affectsCash: confirmed && input.accountType === "checking",
    countsInBudget,
    financialContext: {
      recordedAmount: { amount: input.amount, currency: input.currency },
      recordedImpact: {
        target: inferredBucket,
        basis: "recorded_account_type_and_currency",
        debtDirection:
          confirmed && card
            ? input.direction === "debit"
              ? "increase"
              : "decrease"
            : null,
        bucketLink: input.bucket,
        bucketConflict,
        notice:
          "Describe el registro actual, no confirma el cupo definitivo del banco ni demuestra que el saldo se proyectó correctamente.",
      },
      budget: {
        currency: "CLP",
        grossEquivalent: budgetAmount,
        conversion:
          input.currency === "CLP"
            ? "not_needed"
            : budgetAmount === null
              ? "unavailable"
              : "reference_only",
        clpPerUsd: input.currency === "USD" ? rate : null,
        categoryLimit: input.categoryLimit,
        includedInExpensePlan: countsInBudget,
        notice:
          "Equivalente bruto referencial; no cambia moneda ni cupo. El gasto neto y los reembolsos se consultan en presupuesto/medidor. Los ingresos se consultan en el plan de ingresos.",
      },
      reconciliation: {
        bankSettlementVerified: null,
        originalBankAmount: null,
        bankPostingDate: null,
        evidence: input.externalId ? "bank_email_reference" : "app_record",
        notice: input.externalId
          ? "El correo puede expresar en pesos una compra internacional. Este registro no conserva por separado importe original, liquidación o fecha contable: confirmar contra cartola/no facturados. No crear otro gasto por diferencia de fecha o moneda."
          : "El registro en la app no prueba recepción ni liquidación bancaria. Comparar con cartola/no facturados antes de corregir.",
      },
    },
  }
}
