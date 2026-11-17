import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { ProgressBar } from "./blocks"
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
  limit = null,
  onOpenLiquidity,
}: PlanInput & {
  subtitle?: ReactNode
  closed?: boolean // período que no es el en curso: compacto, la cifra grande es la línea de cierre
  limit?: number | null // tope de gasto del período: con él, la barra del tope sobre las tres cifras
  onOpenLiquidity?: () => void
}) {
  const remaining = closed ? spendable.margin : spendable.amount
  const net = cash - overdraftDebt // liquidez registrada: caja menos línea usada
  const keyed = limit !== null
  // Una sola cifra de gastado en la tarjeta (línea, barra y tile), la de antes del rediseño.
  const gastado = spent + reimbursementAdjustment
  // Muestra de color sobre la etiqueta: une «Gastado» y «Comprometido» con su tramo de la barra.
  const swatch = (cls: string) =>
    keyed && <span aria-hidden className={cn("mb-1 block h-1 w-3 rounded-full", cls)} />
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4" role="group" aria-label="Resumen del plan">
      <div className="flex flex-col gap-1">
        <p className="text-body text-ink-2">
          {closed
            ? remaining < 0 ? "Faltó para el plan" : "Quedó del plan"
            : remaining < 0 ? "Te pasaste del plan" : "Disponible para gastar"}
        </p>
        <p
          className={cn(
            "font-semibold whitespace-nowrap",
            closed ? "text-title" : "text-display",
            remaining < 0 ? "text-destructive" : "text-foreground"
          )}
        >
          {formatCLP(Math.abs(remaining))}
        </p>
        {subtitle && <p className="text-callout text-ink-2">{subtitle}</p>}
        {exchangeRateUnavailable && (
          <p className="text-caption text-ink-3">Sin dólar observado: los montos en USD no están sumados.</p>
        )}
        <span className="sr-only">{closed
          ? "Tus ingresos menos lo gastado y comprometido en el período; no es el saldo bancario."
          : "Lo menor entre tu margen (ingresos menos gastado y comprometido) y lo que queda de tus topes; no es el saldo bancario."}</span>
      </div>
      <div className="mt-auto flex flex-col gap-4">
        {keyed && (
          <div className="flex flex-col gap-2">
            {/* En un período cerrado el «Gastaste X de Y» ya lo dice MonthStatus arriba. */}
            {!closed && (
              <p className="flex items-baseline justify-between gap-3 text-caption text-ink-3">
                <span className="whitespace-nowrap">Tope de gasto</span>
                <span className="whitespace-nowrap">
                  <b className="font-semibold text-ink-2">{formatCLP(gastado)}</b> de {formatCLP(limit)}
                </span>
              </p>
            )}
            <ProgressBar
              value={gastado}
              committed={committed}
              max={limit}
              label="Gastado y comprometido del tope de gasto"
              className="h-2"
            />
          </div>
        )}
        <dl className="grid grid-cols-3 gap-3">
          <div className="min-w-0">
            <dt className="text-caption whitespace-nowrap text-ink-3">{swatch("bg-transparent")}Ingresos</dt>
            <dd className="truncate text-callout font-semibold whitespace-nowrap">{formatCLP(income)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-caption whitespace-nowrap text-ink-3">{swatch("bg-bar")}Gastado</dt>
            <dd className="truncate text-callout font-semibold whitespace-nowrap">{formatCLP(gastado)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-caption whitespace-nowrap text-ink-3">{swatch("bg-committed")}Comprometido</dt>
            <dd className="truncate text-callout font-semibold whitespace-nowrap">{formatCLP(committed)}</dd>
          </div>
        </dl>
        <button
          type="button"
          disabled={!onOpenLiquidity}
          onClick={onOpenLiquidity}
          aria-label="Ver detalle de liquidez y cuentas"
          className="press -mx-2 flex min-h-(--ctl) items-center justify-between gap-3 rounded-md px-2 text-left text-callout enabled:hover:bg-secondary disabled:cursor-default"
        >
          <span className={net < 0 ? "text-destructive" : "text-ink-2"}>
            {net < 0 ? "Cuentas en negativo" : "Disponible en cuentas"}
          </span>
          <span className="flex items-center gap-1">
            <strong className={cn("font-semibold whitespace-nowrap", net < 0 && "text-destructive")}>
              {formatCLP(net)}
            </strong>
            {onOpenLiquidity && <ChevronRight aria-hidden className="size-4 text-ink-3" />}
          </span>
        </button>
      </div>
    </div>
  )
}
