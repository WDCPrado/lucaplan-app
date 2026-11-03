import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { formatCLP } from "@/lib/finance-format"
import type { SpendableDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

export type PlanInput = {
  cash: number
  overdraftDebt: number
  reimbursementAdjustment?: number
  income: number
  spent: number
  committed: number
  exchangeRateUnavailable?: boolean // sin dólar observado: lo en USD no entra en las cifras
  spendable: SpendableDTO // titular: lo menor entre el margen y lo planificado que queda (servidor)
}

/**
 * Resumen del plan del Inicio. Primero y más grande, lo disponible para gastar según lo planificado
 * (`spendable`, del servidor: lo menor entre el margen y lo que queda de los topes; no es el saldo
 * bancario); debajo, la línea que manda quien lo muestra (los días para cerrar); después los tres
 * componentes del margen y lo disponible en cuentas. En un período cerrado la cifra es el margen:
 * lo que de verdad sobró o faltó de los ingresos.
 */
export function PlanSummary({
  income,
  spent,
  committed,
  reimbursementAdjustment = 0,
  cash,
  overdraftDebt,
  exchangeRateUnavailable = false,
  spendable,
  subtitle,
  closed = false,
  onOpenLiquidity,
}: PlanInput & {
  subtitle?: ReactNode
  closed?: boolean // período que no es el en curso: compacto, la cifra grande es la línea de cierre
  onOpenLiquidity?: () => void
}) {
  const remaining = closed ? spendable.margin : spendable.amount
  const net = cash - overdraftDebt // liquidez registrada: caja menos línea usada
  return (
    <div className="flex min-w-0 flex-col gap-4" role="group" aria-label="Resumen del plan">
      <div className="space-y-1">
        <p className="text-subheadline text-muted-foreground">
          {closed
            ? remaining < 0 ? "Faltó para el plan" : "Quedó del plan"
            : remaining < 0 ? "Te pasaste del plan" : "Disponible para gastar"}
        </p>
        <p className={`tabular font-bold tracking-tight ${closed ? "text-title-3" : "text-hero"} ${remaining < 0 ? "text-destructive" : "text-foreground"}`}>{formatCLP(Math.abs(remaining))}</p>
        {subtitle && <p className="text-subheadline text-muted-foreground">{subtitle}</p>}
        {exchangeRateUnavailable && (
          <p className="text-footnote text-muted-foreground">Sin dólar observado: los montos en USD no están sumados.</p>
        )}
        <span className="sr-only">{closed
          ? "Tus ingresos menos lo gastado y comprometido en el período; no es el saldo bancario."
          : "Lo menor entre tu margen (ingresos menos gastado y comprometido) y lo que queda de tus topes; no es el saldo bancario."}</span>
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
