"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { es } from "date-fns/locale"
import { toast } from "sonner"
import { CalendarClock, ChevronRight, SlidersHorizontal } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import {
  formatCLP,
  formatLongDate,
  monthName,
  todayKey,
  usagePct,
} from "@/lib/finance-format"
import { dailyAllowance } from "@/lib/day-spend"
import {
  estimateClosing,
  type PeriodMode,
} from "@/arch/shared/billing-cycle"
import type { CycleProps } from "./dashboard"

/**
 * Estado del mes convertido en UNA decisión: cuánto puedes gastar hoy. Es lo libre del mes
 * (presupuesto − gastado − comprometido) repartido en los días que quedan. En un mes pasado el
 * titular es con cuánto cerró; sin presupuesto, lo que corresponde es definirlo.
 *
 * Este bloque NO dice "te pasaste": ese aviso vive entero en la banda de excedente que va justo
 * debajo (WDC-73). Pasado el presupuesto, acá el número es $0 y punto. Si aún queda plata sin
 * repartir entre categorías, se avisa con un nudge que abre el plan.
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
  // Modo y ciclo: van justo encima de la tira de días, que es el rango que describen.
  const cycleBar = <CycleBar period={period} cycle={cycle} />

  if (globalLimit === null) {
    return (
      <section className="glass rounded-xl p-5 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-heading text-lg font-bold">
              Define tu presupuesto de {mes}
            </h2>
            <p className="mt-1 text-sm text-pretty text-muted-foreground">
              Con un límite del mes podemos decirte cuánto puedes gastar hoy, ya
              descontando lo que está comprometido.
            </p>
          </div>
          <Button onClick={onOpenPlan} className="h-11 shrink-0">
            Definir presupuesto
          </Button>
        </div>
        {cycleBar}
        {children && <div className="mt-3">{children}</div>}
      </section>
    )
  }

  const free = globalLimit - spent - committed
  const usedPct = usagePct(spent, globalLimit)
  const todayIso = `${todayKey()}T00:00:00.000Z`

  return (
    <section className="glass relative rounded-xl p-5 lg:p-6">
      {/* Editar el plan (ingresos, presupuesto) vive acá: es el mismo lugar donde se ve su
          resultado. En móvil se ancla arriba a la derecha para no quitarle ancho al titular. */}
      <Button
        variant="secondary"
        onClick={onOpenPlan}
        aria-label="Ajustar el plan del mes"
        // Con nombre también en móvil: el icono de sliders solo no decía qué abría.
        className="absolute top-5 right-5 z-10 max-sm:h-9 max-sm:px-3 max-sm:text-xs sm:h-10 lg:top-6 lg:right-6"
      >
        <SlidersHorizontal className="size-4" />
        Ajustar plan
      </Button>

      <div className="sm:pr-40">
        {isCurrentMonth ? (
          <>
            {/* Solo la fecha esquiva el botón; el titular usa el ancho entero. */}
            <p className="text-sm text-muted-foreground max-sm:pr-32">
              Hoy, {formatLongDate(todayIso)}
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="tabular text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                {formatCLP(dailyAllowance(free, daysLeft))}
              </span>
              <span className="font-heading text-lg font-semibold sm:text-xl">
                libre hoy
              </span>
            </p>
            {/* Prosa en la fuente de texto; solo los montos en mono (design system: mono = cifras). */}
            <p className="mt-2 text-sm text-pretty text-muted-foreground">
              {free > 0 ? (
                <>
                  <span className="tabular">{formatCLP(free)}</span> libres para{" "}
                  {daysLeft === 1
                    ? "el día que queda"
                    : `los ${daysLeft} días que quedan`}
                  {committed > 0 && (
                    <>
                      , ya descontado lo comprometido (
                      <span className="tabular">{formatCLP(committed)}</span>)
                    </>
                  )}
                  . Cada día sin gastar suma al siguiente.
                </>
              ) : (
                "No queda presupuesto libre este mes."
              )}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground max-sm:pr-32">
              {monthName(period.month)} {period.year} cerró con
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="tabular text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                {formatCLP(Math.max(0, free))}
              </span>
              <span className="font-heading text-lg font-semibold sm:text-xl">
                sin gastar
              </span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Gastaste <span className="tabular">{formatCLP(spent)}</span> de{" "}
              <span className="tabular">{formatCLP(globalLimit)}</span>
              {usedPct !== null && (
                <>
                  {" "}
                  · <span className="tabular">{Math.round(usedPct)}%</span>
                </>
              )}
            </p>
          </>
        )}
      </div>

      {cycleBar}
      {children && <div className="mt-3">{children}</div>}

      {/* Nudge de asignación: solo aparece cuando hay algo que hacer (falta repartir o te pasaste
          asignando). Abre el plan, que es donde se reparte. En $0 no molesta. */}
      {remainingToAllocate !== null && remainingToAllocate !== 0 && (
        <button
          onClick={onOpenPlan}
          className={cn(
            "mt-4 flex w-full items-center justify-between gap-2 rounded-lg px-4 py-2.5 text-left text-sm transition-colors",
            remainingToAllocate < 0
              ? "bg-destructive/10 text-destructive hover:bg-destructive/15"
              : "bg-secondary/50 hover:bg-accent"
          )}
        >
          <span className="min-w-0">
            {remainingToAllocate < 0
              ? `Sobre-asignado ${formatCLP(Math.abs(remainingToAllocate))} en categorías`
              : `Te falta repartir ${formatCLP(remainingToAllocate)} en categorías`}
          </span>
          <ChevronRight className="size-4 shrink-0 opacity-60" />
        </button>
      )}
    </section>
  )
}

// «23 sep», del "YYYY-MM-DD" civil sin pasar por la zona horaria.
function shortDate(day: string): string {
  const m = monthName(Number(day.slice(5, 7))).slice(0, 3).toLowerCase()
  return `${Number(day.slice(8, 10))} ${m}`
}

async function apiError(res: Response | null, fallback: string) {
  const data = await res?.json().catch(() => null)
  return typeof data?.error === "string" ? data.error : fallback
}

/**
 * Fila del período: en modo tarjeta, el rango del ciclo y su cierre (corregible); a la derecha, el
 * switch de modo. En móvil se parte en dos líneas: el ciclo arriba y el switch debajo.
 */
function CycleBar({
  period,
  cycle,
}: {
  period: { year: number; month: number }
  cycle: CycleProps
}) {
  const router = useRouter()
  const switchId = useId()
  // Optimista: el switch cambia al toque; si falla vuelve y avisa. Cuando el servidor ya trae el
  // modo nuevo, el valor local sobra y se suelta en render.
  const [optimistic, setOptimistic] = useState<PeriodMode | null>(null)
  if (optimistic !== null && optimistic === cycle.mode) setOptimistic(null)
  const mode = optimistic ?? cycle.mode
  const card = mode === "card_cycle"

  async function changeMode(checked: boolean) {
    const next: PeriodMode = checked ? "card_cycle" : "calendar"
    haptic("light")
    setOptimistic(next)
    const res = await fetch("/api/period-mode", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: next }),
    }).catch(() => null)
    if (!res?.ok) {
      setOptimistic(null)
      toast.error(await apiError(res, "No se pudo cambiar el modo."))
      return
    }
    // Al mes en curso del modo nuevo: con el modo tarjeta, el 28/09 ya es octubre.
    if (window.location.search) router.push("/dashboard")
    else router.refresh()
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
      {/* El rango que trae el servidor es el del modo guardado: se muestra solo cuando el modo
          guardado y el del switch coinciden en tarjeta. */}
      {cycle.mode === "card_cycle" && card && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-base text-muted-foreground sm:text-sm">
            Ciclo{" "}
            <span className="font-medium text-foreground tabular-nums">
              {shortDate(cycle.range.start)} – {shortDate(cycle.range.end)}
            </span>
          </p>
          <ClosingPicker period={period} closing={cycle.closing} />
        </div>
      )}
      <div className="ml-auto flex min-h-11 items-center gap-3">
        <Label
          htmlFor={switchId}
          className="cursor-pointer text-base font-medium sm:text-sm"
        >
          {card ? "Modo tarjeta de crédito" : "Modo débito"}
        </Label>
        <Switch
          id={switchId}
          checked={card}
          disabled={optimistic !== null}
          onCheckedChange={changeMode}
        />
      </div>
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          aria-label={`Cierre de ${mes}: ${shortDate(closing.date)}${closing.estimated ? ", estimado" : ""}. Corregir`}
          className="h-11 gap-2 px-3 text-base font-normal sm:h-9 sm:text-sm"
        >
          <CalendarClock className="size-4 text-muted-foreground" />
          <span>
            Cierra el{" "}
            <span className="font-medium tabular-nums">
              {shortDate(closing.date)}
            </span>
          </span>
          {closing.estimated && (
            <Badge
              variant="outline"
              className="font-normal text-muted-foreground"
            >
              estimado
            </Badge>
          )}
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
            className="h-11 w-full text-base sm:h-9 sm:text-sm"
          >
            Usar estimado ({shortDate(estimate)})
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
