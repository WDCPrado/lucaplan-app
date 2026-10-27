"use client"

import { formatCLP } from "@/lib/finance-format"
import { calculateFinancialOverview } from "@/lib/financial-health"

type PlanInput = {
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
 * Margen del plan (ingresos − gastos − comprometido) y la liquidez registrada en CLP. Lo usan las
 * dos vistas del Inicio: el medidor y el diario.
 */
export function PlanSummary({ income, spent, committed, reimbursementAdjustment = 0, cash, overdraftDebt }: PlanInput) {
  const health = calculateFinancialOverview({ income, spent, committed, reimbursementAdjustment, cash, overdraftDebt })
  const tone = PLAN_TONE[health.planStatus]
  // Ámbar no llega a 3:1 sobre claro en la cifra grande: al límite, el color queda en la etiqueta.
  const amountTone = health.planStatus === "al_limite" ? "text-foreground" : tone
  const net = health.liquidity.netPosition
  const liquidityLabel = net < 0 ? "Corriente en negativo" : net === 0 ? "Sin liquidez neta" : overdraftDebt > 0 ? "Corriente con línea utilizada" : "Liquidez neta"
  const liquidityTone = health.status === "en_deficit" ? "text-destructive" : health.status === "al_limite" ? "text-warning" : ""

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3" role="group" aria-label="Resumen del plan">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground" title="Ingresos menos gastos y comprometido; no es el saldo bancario.">
          Margen del plan<span className="sr-only">; no es el saldo bancario</span>
        </span>
        <strong className={`text-sm ${tone}`}>{PLAN_LABEL[health.planStatus]}</strong>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium text-muted-foreground">{health.balance < 0 ? "Faltan" : "Quedan"}</span>
        <span className={`tabular text-3xl font-bold tracking-tight ${amountTone}`}>{formatCLP(Math.abs(health.balance))}</span>
      </p>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2 border-t border-border/50 pt-2 text-xs">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Ingresos</dt>
          <dd className="tabular truncate font-semibold">{formatCLP(income)}</dd>
        </div>
        <div className="min-w-0" title={reimbursementAdjustment > 0 ? "Los reembolsos incluidos en ingresos se compensan una sola vez." : undefined}>
          <dt className="text-muted-foreground">Gastos</dt>
          <dd className="tabular truncate font-semibold">{formatCLP(spent + reimbursementAdjustment)}</dd>
          {reimbursementAdjustment > 0 && <span className="sr-only">Los reembolsos incluidos en ingresos se compensan una sola vez.</span>}
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Comprometido</dt>
          <dd className="tabular truncate font-semibold">{formatCLP(committed)}</dd>
        </div>
      </dl>
      <div
        className="flex flex-col gap-1 border-t border-border/50 pt-2 text-xs"
        role="group"
        aria-label="Liquidez registrada"
        title="Últimos saldos registrados; no son el saldo histórico ni proyectado del período."
      >
        <p className={`flex flex-wrap items-baseline gap-x-2 ${liquidityTone}`}>
          <span className={liquidityTone ? "font-semibold" : "text-muted-foreground"}>{liquidityLabel}</span>
          <strong className="tabular font-semibold">{formatCLP(net)}</strong>
          <span className="sr-only">Últimos saldos registrados; no son el saldo histórico ni proyectado del período.</span>
        </p>
        {/* Con la línea en 0 la caja es la liquidez: repetirla no dice nada. */}
        {overdraftDebt > 0 && (
          <p className="tabular text-muted-foreground">Caja {formatCLP(cash)} − Línea usada {formatCLP(overdraftDebt)}</p>
        )}
      </div>
    </div>
  )
}

/** Medidor: resumen y gauge apilados hasta escritorio para que los montos quepan con sidebar. */
export function FinancialHealthMeter(props: PlanInput) {
  const { income, spent, committed, reimbursementAdjustment = 0, cash, overdraftDebt } = props
  const health = calculateFinancialOverview({ income, spent, committed, reimbursementAdjustment, cash, overdraftDebt })
  const label = PLAN_LABEL[health.planStatus]
  const pct = health.utilization
  const angle = pct === null ? 90 : Math.min(90, Math.max(-90, pct * 1.5 - 90))
  const thresholds = "Cubierto bajo 90%, al límite entre 90 y 100%, déficit sobre 100%."

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
      <PlanSummary {...props} />
      <div className="mx-auto w-full max-w-56 shrink-0 sm:w-56">
        <svg
          role="img"
          aria-label={`${label}, ${pct === null ? "sin ingresos" : Math.round(pct) + "% consumido"}`}
          viewBox="0 0 320 170"
          className="w-full"
        >
          <title>{thresholds}</title>
          <path d="M 47 146 A 113 113 0 0 1 273 146" fill="none" stroke="currentColor" opacity=".1" strokeWidth="23" />
          <path d="M 47 146 A 113 113 0 0 1 239.9 66.1" fill="none" stroke="currentColor" className="text-emerald-500" strokeWidth="20" />
          <path d="M 239.9 66.1 A 113 113 0 0 1 257.9 89.5" fill="none" stroke="currentColor" className="text-warning" strokeWidth="20" />
          <path d="M 257.9 89.5 A 113 113 0 0 1 273 146" fill="none" stroke="currentColor" className="text-destructive" strokeWidth="20" />
          <g transform={`rotate(${angle} 160 146)`}>
            <path d="M155 146 L160 42 L165 146 Z" className="fill-foreground" />
            <circle cx="160" cy="146" r="9" className="fill-foreground" />
          </g>
        </svg>
      </div>
    </div>
  )
}
