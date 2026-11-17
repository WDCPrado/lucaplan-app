"use client"

import { useOptimistic, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { es } from "date-fns/locale"
import { toast } from "sonner"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { ResponsivePopover } from "@/components/ui/responsive-modal"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { formatCLP, monthName, usagePct } from "@/lib/finance-format"
import { closedPeriodLine, isFuturePeriod } from "@/lib/period-status"
import { estimateClosing, type PeriodMode } from "@/arch/shared/billing-cycle"
import { PlanSummary, type PlanInput } from "./financial-health-meter"
import { InlineNotice } from "./blocks"
import { Segmented } from "./segmented"
import type { CycleProps } from "./dashboard"

/**
 * Estado del período en el Inicio (la tarjeta principal). En el mes en curso, lo primero y más grande
 * es cuánto queda del plan; los días para cerrar van en la línea de abajo y, al pie, la barra del
 * tope, las tres cifras y lo disponible en cuentas. «Ajustar plan» vive en la tarjeta del ritmo.
 * Fuera del mes en curso, una línea: un futuro todavía no empieza; uno pasado cerró sin gastar o
 * pasado por cuánto (`closedPeriodLine`).
 */
export function MonthStatus({
  period,
  cycle,
  isCurrentMonth,
  daysLeft,
  globalLimit,
  spent,
  plan,
  onOpenPlan,
  onOpenLiquidity,
  className,
}: {
  period: { year: number; month: number }
  cycle: CycleProps
  isCurrentMonth: boolean
  daysLeft: number // días que quedan, hoy incluido; 0 fuera del mes en curso
  globalLimit: number | null
  spent: number
  plan: PlanInput // disponible para gastar (servidor), los componentes del margen y liquidez
  onOpenPlan: () => void
  onOpenLiquidity?: () => void
  className?: string
}) {
  const mes = monthName(period.month).toLowerCase()
  const card = cn(
    "flex min-w-0 flex-col gap-4 rounded-xl bg-card p-(--pad-card) text-card-foreground",
    className
  )

  if (globalLimit === null) {
    return (
      <section aria-label="Plan del mes" className={card}>
        <div className="flex flex-col items-start gap-1">
          <h2 className="text-title font-semibold text-pretty">
            Define tu tope de gasto de {mes}
          </h2>
          <p className="text-callout text-pretty text-ink-2">
            Configura el plan de este período para organizar tus ingresos y gastos.
          </p>
          <Button onClick={onOpenPlan} className="mt-3">
            Definir tope de gasto
          </Button>
        </div>
        <PlanSummary {...plan} closed={!isCurrentMonth && !isFuturePeriod(period, cycle.current)} />
      </section>
    )
  }

  if (isCurrentMonth) {
    // daysLeft incluye hoy; el contador muestra días completos hasta la fecha de cierre.
    const remainingDays = Math.max(0, daysLeft - 1)
    const daysLine =
      daysLeft === 1
        ? "Hoy termina el período"
        : `${remainingDays} ${remainingDays === 1 ? "día" : "días"} para cerrar${
            // En ciclo, el rango ya lo dice el MonthNav de arriba.
            cycle.mode === "calendar" ? ` · ${shortDate(cycle.range.end)}` : ""
          }`
    return (
      <section aria-label="Plan del mes" className={card}>
        <PlanSummary
          {...plan}
          limit={globalLimit}
          subtitle={daysLine}
          onOpenLiquidity={onOpenLiquidity}
        />
      </section>
    )
  }

  const usedPct = usagePct(spent, globalLimit)
  const future = isFuturePeriod(period, cycle.current)
  return (
    <section aria-label="Plan del mes" className={card}>
      <div className="flex flex-col gap-1">
        <p className="text-title font-semibold text-pretty">
          {closedPeriodLine({ period, current: cycle.current, globalLimit, spent })}
        </p>
        {/* Un período que no empieza no tiene gasto que contar. */}
        {!future && (
          <p className="text-callout text-ink-2">
            Gastaste <span className="whitespace-nowrap">{formatCLP(spent)}</span> de{" "}
            <span className="whitespace-nowrap">{formatCLP(globalLimit)}</span>
            {usedPct !== null && <> · {Math.round(usedPct)}%</>}
          </p>
        )}
      </div>
      <PlanSummary
        {...plan}
        closed={!future}
        limit={globalLimit}
        onOpenLiquidity={onOpenLiquidity}
      />
    </section>
  )
}

/**
 * Aviso de asignación, al pie de la tarjeta del ritmo: solo aparece cuando hay algo que hacer (falta
 * repartir o te pasaste asignando). Abre el plan, que es donde se reparte. En $0 no molesta.
 */
export function AllocationNudge({
  remainingToAllocate,
  onOpenPlan,
  className,
}: {
  remainingToAllocate: number | null // null = sin presupuesto
  onOpenPlan: () => void
  className?: string
}) {
  if (remainingToAllocate === null || remainingToAllocate === 0) return null
  const over = remainingToAllocate < 0
  return (
    <InlineNotice
      tone={over ? "alert" : "warn"}
      label={over ? "Sobre-asignado en categorías" : "Te falta repartir en categorías"}
      value={formatCLP(Math.abs(remainingToAllocate))}
      onClick={onOpenPlan}
      className={className}
    />
  )
}

// «23 sep», del "YYYY-MM-DD" civil sin pasar por la zona horaria.
export function shortDate(day: string): string {
  const m = monthName(Number(day.slice(5, 7)))
    .slice(0, 3)
    .toLowerCase()
  return `${Number(day.slice(8, 10))} ${m}`
}

async function apiError(res: Response | null, fallback: string) {
  const data = await res?.json().catch(() => null)
  return typeof data?.error === "string" ? data.error : fallback
}

/**
 * Período del plan: mes calendario o ciclo de la tarjeta. Vive en «Ajustar plan». Optimista: el
 * segmento cambia al toque y, al terminar la transición (guardado + refresco), vuelve solo a lo que
 * diga el servidor: si falló, al modo anterior, con un toast.
 */
export function PeriodModeControl({ mode: savedMode }: { mode: PeriodMode }) {
  const router = useRouter()
  const [mode, setOptimisticMode] = useOptimistic(savedMode)
  const [pending, startTransition] = useTransition()

  function changeMode(next: PeriodMode) {
    haptic("light")
    startTransition(async () => {
      setOptimisticMode(next)
      const res = await fetch("/api/period-mode", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: next }),
      }).catch(() => null)
      if (!res?.ok) {
        toast.error(await apiError(res, "No se pudo cambiar el modo."))
        return
      }
      // Al mes en curso del modo nuevo: con el modo tarjeta, el 28/09 ya es octubre.
      if (window.location.search) router.push("/dashboard")
      else router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <Segmented
        label="Período del plan"
        value={mode}
        disabled={pending}
        onChange={changeMode}
        options={[
          { value: "calendar", label: "Mes calendario" },
          { value: "card_cycle", label: "Ciclo de tarjeta" },
        ]}
      />
      <p className="px-4 text-caption text-ink-3">
        Cada modo conserva su tope de gasto, topes por categoría e ingresos planificados. Ambos incluyen cuenta corriente y tarjeta.
      </p>
    </div>
  )
}

/**
 * El cierre del mes en pantalla, como fila de Ajustes en «Ajustar plan» (solo en modo tarjeta). Se
 * estima (7.º día hábil desde el fin de mes) y se corrige con un calendario limitado a los días de
 * ese mes. Con una corrección guardada, «Usar estimado» la borra.
 */
export function ClosingPicker({
  period,
  closing,
  disabled = false,
}: {
  period: { year: number; month: number }
  closing: { date: string; estimated: boolean }
  disabled?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const mes = monthName(period.month).toLowerCase()
  const estimate = estimateClosing(period.year, period.month)
  const [y, m, d] = closing.date.split("-").map(Number)

  async function save(date: string | null) {
    setSaving(true)
    const res = await fetch("/api/card-closing", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ year: period.year, month: period.month, date }),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) {
      toast.error(await apiError(res, "No se pudo guardar el cierre."))
      return
    }
    haptic("light")
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="tone-rows [&>*]:px-4">
        <ResponsivePopover
          open={open}
          onOpenChange={setOpen}
          title={`Cierre de ${mes}`}
          align="end"
          className="w-auto gap-2 p-3"
          trigger={
              <button
                type="button"
                disabled={disabled}
                aria-label={`Cierre de la tarjeta en ${mes}: ${shortDate(closing.date)}${closing.estimated ? ", estimado" : ""}${disabled ? ". Solo se usa en modo ciclo de tarjeta" : ". Cambiar"}`}
                className="press flex min-h-11 w-full items-center gap-2 py-2.5 text-left disabled:opacity-45"
              >
                <span className="min-w-0 flex-1 text-body">Cierre de la tarjeta</span>
                <span className="text-body whitespace-nowrap text-ink-2">
                  {shortDate(closing.date)}
                </span>
                {closing.estimated && (
                  <span className="text-caption text-ink-3">
                    Estimado
                  </span>
                )}
                <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
              </button>
          }
        >
          <p className="px-1 text-caption text-ink-3 max-md:hidden">Cierre de {mes}</p>
            <Calendar
              mode="single"
              locale={es}
              month={new Date(period.year, period.month - 1, 1)}
              disableNavigation
              showOutsideDays={false}
              disabled={saving}
              selected={new Date(y, m - 1, d)}
              onSelect={(day) => {
                if (!day) return
                const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
                // El mismo día no es una corrección: cerrar sin guardar.
                if (key !== closing.date) void save(key)
                else setOpen(false)
              }}
              // El mes ya lo dice el título de arriba: su encabezado solo dejaba una fila vacía.
              classNames={{ nav: "hidden", month_caption: "sr-only" }}
              className="p-0"
            />
        </ResponsivePopover>
        {!closing.estimated && (
          <button
            type="button"
            disabled={saving || disabled}
            onClick={() => void save(null)}
            className="press flex min-h-11 w-full items-center py-2.5 text-left text-callout font-semibold text-primary disabled:opacity-45"
          >
            Usar estimado ({shortDate(estimate)})
          </button>
        )}
      </div>
      <p className="px-4 text-caption text-ink-3">
        El ciclo va del día después del cierre anterior hasta este día.
      </p>
    </div>
  )
}
