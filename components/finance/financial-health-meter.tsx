import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { formatCLP } from "@/lib/finance-format"
import { calculateFinancialOverview } from "@/lib/financial-health"

export type PlanInput = {
  cash: number
  overdraftDebt: number
  reimbursementAdjustment?: number
  income: number
  spent: number
  committed: number
  exchangeRateUnavailable?: boolean // sin dólar observado: lo en USD no entra en las cifras
}

/**
 * Resumen del plan del Inicio. Primero y más grande, ingresos planificados menos gasto realizado
 * y comprometido (no es el saldo bancario); debajo, la línea secundaria que manda quien lo muestra
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
  exchangeRateUnavailable = false,
  subtitle,
  onOpenLiquidity,
}: PlanInput & { subtitle?: ReactNode; onOpenLiquidity?: () => void }) {
  const health = calculateFinancialOverview({ income, spent, committed, reimbursementAdjustment, cash, overdraftDebt })
  const remaining = health.balance
  const net = health.liquidity.netPosition
  return (
    <div className="flex min-w-0 flex-col gap-4" role="group" aria-label="Resumen del plan">
      <div className="space-y-1">
        <p className="text-subheadline text-muted-foreground">{remaining < 0 ? "Faltan para cubrir el plan" : "Disponible para planificar"}</p>
        <p className={`tabular text-hero font-bold tracking-tight ${remaining < 0 ? "text-destructive" : "text-foreground"}`}>{formatCLP(Math.abs(remaining))}</p>
        {subtitle && <p className="text-subheadline text-muted-foreground">{subtitle}</p>}
        {exchangeRateUnavailable && (
          <p className="text-footnote text-muted-foreground">Sin dólar observado: los montos en USD no están sumados</p>
        )}
        <span className="sr-only">Ingresos planificados menos gasto realizado y comprometido; no es el saldo bancario.</span>
      </div>
      <dl className="grid grid-cols-3 gap-3 text-footnote">
        <div className="min-w-0"><dt className="text-muted-foreground">Ingresos</dt><dd className="tabular truncate text-subheadline font-semibold">{formatCLP(income)}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">Gastado</dt><dd className="tabular truncate text-subheadline font-semibold">{formatCLP(spent + reimbursementAdjustment)}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">Comprometido</dt><dd className="tabular truncate text-subheadline font-semibold">{formatCLP(committed)}</dd></div>
      </dl>
      <button type="button" disabled={!onOpenLiquidity} onClick={onOpenLiquidity}
        className="press flex min-h-11 items-center justify-between gap-3 rounded-lg px-1 text-left hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
        aria-label="Ver detalle de liquidez y cuentas">
        <span className={`text-subheadline ${net < 0 ? "text-destructive" : "text-muted-foreground"}`}>{net < 0 ? "Cuentas en negativo" : "Disponible en cuentas"}</span>
        <span className="flex items-center gap-1"><strong className={`tabular text-subheadline font-semibold ${net < 0 ? "text-destructive" : ""}`}>{formatCLP(net)}</strong>{onOpenLiquidity && <ChevronRight aria-hidden className="size-4 text-muted-foreground" />}</span>
      </button>
    </div>
  )
}
