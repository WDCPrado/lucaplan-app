"use client"

import { useOptimistic, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { es } from "date-fns/locale"
import { toast } from "sonner"
import { CalendarClock, Pencil, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { formatCLP, monthName } from "@/lib/finance-format"
import { dailyAllowance } from "@/lib/day-spend"
import { estimateClosing, type PeriodMode } from "@/arch/shared/billing-cycle"
import type { CycleProps } from "./dashboard"

/**
 * Estado del mes convertido en UNA decisión: cuánto puedes gastar hoy. Es lo libre del mes
 * (presupuesto − gastado − comprometido) repartido en los días que quedan. En un mes pasado el
 * titular es con cuánto cerró; sin presupuesto, lo que corresponde es definirlo.
 *
 * Este bloque NO dice "te pasaste": ese aviso vive entero en la banda de excedente que va justo
 * debajo (WDC-73). Pasado el presupuesto, acá el número es $0 y punto. Si aún queda plata sin
 * repartir entre categorías, se muestra junto al presupuesto; Ajustar plan la distribuye.
 */
export function MonthStatus({
  period,
  cycle,
  isCurrentMonth,
  daysLeft,
  globalLimit,
  spent,
  committed,
  remainingToAllocate,
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
  remainingToAllocate: number | null // lo que falta repartir entre categorías (null = sin presupuesto)
  onOpenPlan: () => void
  children?: React.ReactNode // la tira de días, debajo del titular
}) {
  const mes = monthName(period.month).toLowerCase()
  const future =
    period.year * 12 + period.month >
    cycle.current.year * 12 + cycle.current.month
  const free = globalLimit === null ? null : globalLimit - spent - committed
  return (
    <section aria-label="Resumen del plan" className="home-summary space-y-4">
      <CycleBar period={period} cycle={cycle} />
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        {free === null ? (
          <div className="space-y-4">
            <h2 className="font-heading text-xl font-semibold">
              Define tu presupuesto de {mes}
            </h2>
            <p className="text-sm text-muted-foreground">
              El plan descuenta lo gastado y comprometido para mostrarte cuánto
              puedes gastar hoy.
            </p>
            <Button onClick={onOpenPlan} className="min-h-11">
              Definir presupuesto
            </Button>
          </div>
        ) : (
          <>
            <div className="home-summary-content">
              <div className="home-summary-head flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="home-summary-title text-primary">
                    <p className="text-3xl font-bold tracking-tight tabular-nums">
                      {formatCLP(
                        isCurrentMonth
                          ? dailyAllowance(free, daysLeft)
                          : Math.max(0, free)
                      )}
                    </p>
                    <h2 className="font-heading text-xl font-semibold">
                      {isCurrentMonth
                        ? "Libre hoy"
                        : future
                          ? "Presupuesto disponible"
                          : "Sin gastar al cierre"}
                    </h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isCurrentMonth
                      ? `${daysLeft} ${daysLeft === 1 ? "día restante" : "días restantes"}`
                      : `${monthName(period.month)} ${period.year}`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={onOpenPlan}
                  className="home-summary-mobile-action min-h-11 shrink-0"
                  aria-label="Ajustar el plan del mes"
                >
                  Ajustar plan
                </Button>
              </div>
              <div className="home-summary-details min-w-0">
                <dl className="home-summary-totals">
                  {[
                    ["Presupuesto", globalLimit!],
                    ["Gastado", spent],
                    ["Comprometido", committed],
                    ["Disponible", Math.max(0, free)],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className={cn(
                        "min-w-0",
                        label === "Presupuesto" && "home-summary-budget"
                      )}
                    >
                      <dt className="text-sm text-muted-foreground">{label}</dt>
                      <dd className="mt-1 text-base font-semibold break-words tabular-nums">
                        {formatCLP(Number(value))}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3 flex items-center gap-3">
                  <div
                    className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-muted"
                    aria-hidden="true"
                  >
                    <span
                      className="bg-primary"
                      style={{
                        width: `${Math.min(100, Math.max(0, (spent / Math.max(1, globalLimit!)) * 100))}%`,
                      }}
                    />
                    <span
                      className="bg-primary/35"
                      style={{
                        width: `${Math.min(Math.max(0, 100 - (spent / Math.max(1, globalLimit!)) * 100), Math.max(0, (committed / Math.max(1, globalLimit!)) * 100))}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {globalLimit! > 0
                      ? Math.round(((spent + committed) / globalLimit!) * 100)
                      : 0}
                    %
                  </span>
                </div>
                <div className="home-summary-mobile-budget mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <p>
                    Presupuesto{" "}
                    <span className="tabular-nums">
                      {formatCLP(globalLimit!)}
                    </span>
                  </p>
                  {remainingToAllocate !== null &&
                    remainingToAllocate !== 0 && (
                      <p
                        className={cn(
                          remainingToAllocate < 0 && "text-destructive"
                        )}
                      >
                        {remainingToAllocate < 0
                          ? `Sobre-asignado ${formatCLP(Math.abs(remainingToAllocate))}`
                          : `${formatCLP(remainingToAllocate)} por repartir`}
                      </p>
                    )}
                </div>
              </div>
              <Button
                variant="outline"
                onClick={onOpenPlan}
                className="home-summary-desktop-action min-h-11"
                aria-label="Ajustar el plan del mes"
              >
                <SlidersHorizontal className="size-4" /> Ajustar plan
              </Button>
            </div>
            {free <= 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                No queda presupuesto libre en este período.
              </p>
            )}
          </>
        )}
        {children}
        {remainingToAllocate !== null && remainingToAllocate !== 0 && (
          <p
            className={cn(
              "home-summary-allocation mt-3 text-sm text-muted-foreground",
              remainingToAllocate < 0 && "text-destructive"
            )}
          >
            {remainingToAllocate < 0
              ? `Sobre-asignado ${formatCLP(Math.abs(remainingToAllocate))} en categorías`
              : `${formatCLP(remainingToAllocate)} por repartir`}
          </p>
        )}
      </div>
    </section>
  )
}

// «23 sep», del "YYYY-MM-DD" civil sin pasar por la zona horaria.
function shortDate(day: string): string {
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
 * Modo del presupuesto y ciclo corregible. En móvil el rango y el cierre comparten un
 * único control de dos líneas debajo del switch.
 */
function CycleBar({
  period,
  cycle,
}: {
  period: { year: number; month: number }
  cycle: CycleProps
}) {
  const router = useRouter()
  // Optimista: el switch cambia al toque y, al terminar la transición (guardado + refresco),
  // vuelve solo a lo que diga el servidor: si falló, al modo anterior, con un toast.
  const [mode, setOptimisticMode] = useOptimistic(cycle.mode)
  const [pending, startTransition] = useTransition()
  const card = mode === "card_cycle"

  function changeMode(checked: boolean) {
    const next: PeriodMode = checked ? "card_cycle" : "calendar"
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
    <div className="flex flex-wrap items-center gap-3" aria-busy={pending}>
      <div
        role="group"
        aria-label="Modo del presupuesto"
        className="grid w-full grid-cols-2 rounded-lg border border-border bg-secondary p-1 sm:w-64"
      >
        {(
          [
            ["calendar", "Débito"],
            ["card_cycle", "Crédito"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={mode === value}
            disabled={pending}
            onClick={() => {
              if (mode !== value) changeMode(value === "card_cycle")
            }}
            className={cn(
              "min-h-11 rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-60",
              mode === value
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent"
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {cycle.mode === "card_cycle" && card ? (
        <div className="w-full md:w-auto">
          <ClosingPicker
            period={period}
            closing={cycle.closing}
            range={cycle.range}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {pending
            ? "Actualizando período…"
            : `Mes calendario · ${shortDate(cycle.range.start)} – ${shortDate(cycle.range.end)}`}
        </p>
      )}
    </div>
  )
}

/**
 * El cierre del mes en pantalla: se estima (7.º día hábil desde el fin de mes) y se corrige con un
 * calendario limitado a los días de ese mes. Con una corrección guardada, «Usar estimado» la borra.
 */
function ClosingPicker({
  period,
  closing,
  range,
}: {
  period: { year: number; month: number }
  closing: { date: string; estimated: boolean }
  range: { start: string; end: string }
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          aria-label={`Cierre de ${mes}: ${shortDate(closing.date)}${closing.estimated ? ", estimado" : ""}. Corregir`}
          className="h-auto min-h-16 w-full justify-start gap-3 border border-border bg-card px-3 py-2 text-sm font-normal hover:bg-accent md:min-h-11 md:w-auto"
        >
          <CalendarClock className="size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-left md:flex md:flex-wrap md:items-center md:gap-x-3">
            <span className="block font-medium tabular-nums">
              {shortDate(range.start)} – {shortDate(range.end)}
            </span>
            <span className="block text-muted-foreground">
              Cierre{" "}
              <span className="tabular-nums">{shortDate(closing.date)}</span>
              {closing.estimated && " · estimado"}
            </span>
          </span>
          <Pencil className="size-4 shrink-0 text-primary" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-2 p-3">
        <p className="px-1 text-sm text-muted-foreground">
          ¿Qué día cierra la facturación de {mes}?
        </p>
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
          classNames={{ nav: "hidden" }}
          className="p-0"
        />
        {!closing.estimated && (
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => void save(null)}
            className="h-11 w-full text-base sm:text-sm"
          >
            Usar estimado ({shortDate(estimate)})
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
