import type { ReactNode } from "react"
import { formatCLP } from "@/lib/finance-format"
import { calculateFinancialOverview } from "@/lib/financial-health"

export type PlanInput = {
  cash: number
  overdraftDebt: number
  reimbursementAdjustment?: number
  income: number
  spent: number
  committed: number
}

const PLAN_LABEL = {
  sano: "Plan cubierto",
  al_limite: "Plan al límite",
  en_deficit: "Plan en déficit",
} as const

const PLAN_TONE = {
  sano: "text-success",
  al_limite: "text-warning",
  en_deficit: "text-destructive",
} as const

/**
 * Resumen del plan del Inicio. Primero y más grande, cuánto queda del plan (ingresos − gastos −
 * comprometido; no es el saldo bancario); debajo, la línea secundaria que manda quien lo muestra
 * (los días para cerrar) con el estado del plan; después sus tres componentes y lo disponible en
 * cuentas.
 */
export function PlanSummary({
  income,
  spent,
  committed,
  reimbursementAdjustment = 0,
  cash,
  overdraftDebt,
  subtitle,
}: PlanInput & { subtitle?: ReactNode }) {
  const health = calculateFinancialOverview({ income, spent, committed, reimbursementAdjustment, cash, overdraftDebt })
  const tone = PLAN_TONE[health.planStatus]
  // Ámbar no llega a 3:1 sobre claro en la cifra grande: al límite, el color queda en la etiqueta.
  const amountTone = health.planStatus === "al_limite" ? "text-foreground" : tone
  const liquidityTone = health.status === "en_deficit" ? "text-destructive" : health.status === "al_limite" ? "text-warning" : ""

  return (
    <div className="flex min-w-0 flex-col gap-3" role="group" aria-label="Resumen del plan">
      <div>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-title-3 font-semibold">{health.balance < 0 ? "Faltan" : "Quedan"}</span>
          <span className={`tabular text-hero font-bold ${amountTone}`}>{formatCLP(Math.abs(health.balance))}</span>
          <span className="sr-only">del plan; no es el saldo bancario</span>
        </p>
        <p className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-subheadline">
          {subtitle && <span className="text-muted-foreground">{subtitle}</span>}
          <strong className={`font-semibold ${tone}`}>{PLAN_LABEL[health.planStatus]}</strong>
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-0.5 border-t border-border pt-3 text-footnote">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Ingresos</dt>
          <dd className="tabular truncate text-subheadline font-semibold">{formatCLP(income)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Gastos</dt>
          <dd className="tabular truncate text-subheadline font-semibold">{formatCLP(spent + reimbursementAdjustment)}</dd>
          {reimbursementAdjustment > 0 && <span className="sr-only">Los reembolsos incluidos en ingresos se compensan una sola vez.</span>}
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Comprometido</dt>
          <dd className="tabular truncate text-subheadline font-semibold">{formatCLP(committed)}</dd>
        </div>
      </dl>
      {/* Liquidez registrada (últimos saldos, neta de la línea usada): una sola línea. */}
      <p className={`flex flex-wrap items-baseline gap-x-2 border-t border-border pt-3 text-footnote ${liquidityTone}`}>
        <span className={liquidityTone ? "font-semibold" : "text-muted-foreground"}>Disponible en cuentas</span>
        <strong className="tabular font-semibold">{formatCLP(health.liquidity.netPosition)}</strong>
      </p>
    </div>
  )
}
