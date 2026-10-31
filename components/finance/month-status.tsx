"use client"

import { useOptimistic, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { es } from "date-fns/locale"
import { toast } from "sonner"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { formatCLP, monthName, usagePct } from "@/lib/finance-format"
import { estimateClosing, type PeriodMode } from "@/arch/shared/billing-cycle"
import { PlanSummary, type PlanInput } from "./financial-health-meter"
import { Segmented } from "./segmented"
import type { CycleProps } from "./dashboard"

/**
 * Estado del período en el Inicio. En el mes en curso, lo primero y más grande es cuánto queda del
 * plan; los días para cerrar van en la línea de abajo. Al pie, «Ajustar plan», que abre donde se
 * decide todo esto (también el modo del período y el cierre de la tarjeta).
 * Para períodos históricos se conserva el saldo final sin gastar.
 */
export function MonthStatus({
  period,
  cycle,
  isCurrentMonth,
  daysLeft,
  globalLimit,
  spent,
  committed,
  plan,
  onOpenPlan,
  children,
}: {
  period: { year: number; month: number }
  cycle: CycleProps
  isCurrentMonth: boolean
  daysLeft: number // días que quedan, hoy incluido; 0 fuera del mes en curso
  globalLimit: number | null
  spent: number
  committed: number
  plan: PlanInput // resumen del plan (ingresos − gastos − comprometido) y liquidez
  onOpenPlan: () => void
  children?: React.ReactNode // la tira de días
}) {
  const mes = monthName(period.month).toLowerCase()

  // Última fila de la tarjeta: abre el plan, donde se decide todo (también el período y el cierre).
  const footer = (
    <button
      type="button"
      onClick={onOpenPlan}
      className="press -mx-5 -mb-5 mt-4 flex min-h-12 w-[calc(100%+2.5rem)] items-center justify-between gap-2 rounded-b-xl border-t border-border px-5 text-left text-body text-primary hover:bg-foreground/5 focus-visible:-outline-offset-2 lg:-mx-6 lg:-mb-6 lg:w-[calc(100%+3rem)] lg:px-6"
    >
      Ajustar plan
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
    </button>
  )

  if (globalLimit === null) {
    return (
      <section className="glass rounded-xl p-5 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-title-3 font-bold">
              Define tu presupuesto de {mes}
            </h2>
            <p className="mt-1 text-subheadline text-pretty text-muted-foreground">
              Configura el plan de este período para organizar tus ingresos y gastos.
            </p>
          </div>
          <Button onClick={onOpenPlan} className="h-11 shrink-0">
            Definir presupuesto
          </Button>
        </div>
        <div className="mt-4">
          <PlanSummary {...plan} />
        </div>
        {children && <div className="mt-4">{children}</div>}
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
      <section className="glass rounded-xl p-5 lg:p-6">
        <PlanSummary {...plan} subtitle={daysLine} />
        {children && <div className="mt-4">{children}</div>}
        {footer}
      </section>
    )
  }

  const free = globalLimit - spent - committed
  const usedPct = usagePct(spent, globalLimit)
  return (
    <section className="glass rounded-xl p-5 lg:p-6">
      <p className="text-subheadline text-muted-foreground">
        {monthName(period.month)} {period.year} cerró con
      </p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
        <span className="tabular text-hero font-bold">
          {formatCLP(Math.max(0, free))}
        </span>
        <span className="text-headline font-semibold">sin gastar</span>
      </p>
      <p className="mt-2 text-subheadline text-muted-foreground">
        Gastaste <span className="tabular">{formatCLP(spent)}</span> de{" "}
        <span className="tabular">{formatCLP(globalLimit)}</span>
        {usedPct !== null && (
          <>
            {" "}
            · <span className="tabular">{Math.round(usedPct)}%</span>
          </>
        )}
      </p>
      <div className="mt-4 border-t border-border pt-4">
        <PlanSummary {...plan} />
      </div>
      {children && <div className="mt-4">{children}</div>}
      {footer}
    </section>
  )
}

/**
 * Nudge de asignación, debajo de la tarjeta del día: solo aparece cuando hay algo que hacer (falta
 * repartir o te pasaste asignando). Abre el plan, que es donde se reparte. En $0 no molesta.
 */
export function AllocationNudge({
  remainingToAllocate,
  onOpenPlan,
}: {
  remainingToAllocate: number | null // null = sin presupuesto
  onOpenPlan: () => void
}) {
  if (remainingToAllocate === null || remainingToAllocate === 0) return null
  return (
    <button
      onClick={onOpenPlan}
      className={cn(
        "press flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-subheadline",
        remainingToAllocate < 0
          ? "bg-destructive/10 text-destructive hover:bg-destructive/15"
          : "bg-card hover:bg-accent"
      )}
    >
      <span className="min-w-0">
        {remainingToAllocate < 0
          ? `Sobre-asignado ${formatCLP(Math.abs(remainingToAllocate))} en categorías`
          : `Te falta repartir ${formatCLP(remainingToAllocate)} en categorías`}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
    </button>
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
      <p className="px-4 text-footnote text-muted-foreground">
        Cada modo conserva su presupuesto, topes e ingresos planificados. Ambos incluyen cuenta corriente y tarjeta.
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
}: {
  period: { year: number; month: number }
  closing: { date: string; estimated: boolean }
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
      <div className="sheet-group inset-list px-4">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Cierre de la tarjeta en ${mes}: ${shortDate(closing.date)}${closing.estimated ? ", estimado" : ""}. Cambiar`}
              className="press flex min-h-11 w-full items-center gap-2 py-2.5 text-left"
            >
              <span className="min-w-0 flex-1 text-body">Cierre de la tarjeta</span>
              <span className="text-body text-muted-foreground tabular-nums">
                {shortDate(closing.date)}
              </span>
              {closing.estimated && (
                <span className="text-footnote text-muted-foreground">
                  Estimado
                </span>
              )}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto gap-2 p-3">
            <p className="px-1 text-footnote text-muted-foreground">Cierre de {mes}</p>
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
          </PopoverContent>
        </Popover>
        {!closing.estimated && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void save(null)}
            className="press flex min-h-11 w-full items-center py-2.5 text-left text-body text-primary disabled:opacity-50"
          >
            Usar estimado ({shortDate(estimate)})
          </button>
        )}
      </div>
      <p className="px-4 text-footnote text-muted-foreground">
        El ciclo va del día después del cierre anterior hasta este día.
      </p>
    </div>
  )
}
