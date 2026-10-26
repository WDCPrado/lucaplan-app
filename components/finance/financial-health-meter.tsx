"use client"

import { formatCLP } from "@/lib/finance-format"
import { calculateFinancialOverview } from "@/lib/financial-health"

export function FinancialHealthMeter({ income, spent, committed, reimbursementAdjustment = 0, cash, overdraftDebt }: {
  cash: number
  overdraftDebt: number
  reimbursementAdjustment?: number
  income: number
  spent: number
  committed: number
}) {
  const health = calculateFinancialOverview({ income, spent, committed, reimbursementAdjustment, cash, overdraftDebt })
  const label = {
    sano: "Plan cubierto",
    al_limite: "Plan al límite",
    en_deficit: "Plan en déficit",
  }[health.planStatus]
  const tone = {
    sano: "text-emerald-500",
    al_limite: "text-warning",
    en_deficit: "text-destructive",
  }[health.planStatus]
  const pct = health.utilization
  const angle = pct === null ? 90 : Math.min(90, Math.max(-90, pct * 1.5 - 90))

  return (
    <div className="flex w-full flex-col gap-2" aria-label="Plan del período">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Plan del período</span>
        <strong className={`text-sm ${tone}`}>{label}</strong>
      </div>
      <div className="relative mx-auto w-full max-w-[280px]">
        <svg role="img" aria-label={`${label}, ${pct === null ? "sin ingresos" : Math.round(pct) + "% consumido"}`} viewBox="0 0 320 170" className="w-full">
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
      <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
        <span className="text-emerald-500">Cubierto · &lt;90%</span>
        <span className="text-warning">Al límite · 90–100%</span>
        <span className="text-destructive">Déficit · &gt;100%</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-xs">
        <span>Ingresos {formatCLP(income)} · Gastos {formatCLP(spent + reimbursementAdjustment)} · Comprometido {formatCLP(committed)}</span>
        <strong className={tone}>{health.balance < 0 ? "Faltan " : "Quedan "}{formatCLP(Math.abs(health.balance))}</strong>
      </div>
      <div className="border-t border-border/50 pt-2 text-xs" aria-label="Liquidez registrada">
        <p className={health.status === "en_deficit" ? "font-semibold text-destructive" : health.status === "al_limite" ? "font-semibold text-warning" : "font-semibold"}>
          {health.liquidity.netPosition < 0 ? "Corriente en negativo" : health.liquidity.netPosition === 0 ? "Sin liquidez neta" : overdraftDebt > 0 ? "Corriente con línea utilizada" : "Liquidez neta"}: {formatCLP(health.liquidity.netPosition)}
        </p>
        <p className="text-muted-foreground">Caja {formatCLP(cash)} · Línea utilizada {formatCLP(overdraftDebt)}</p>
        <p className="text-muted-foreground">Últimos saldos registrados; no son el saldo histórico ni proyectado del período seleccionado.</p>
      </div>
      <p className="text-[11px] text-muted-foreground">Margen del plan; no es saldo bancario.{reimbursementAdjustment > 0 ? " Los reembolsos incluidos en ingresos se compensan una sola vez." : ""}</p>
    </div>
  )
}

