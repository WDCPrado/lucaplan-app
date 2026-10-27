"use client"

import { useId, useOptimistic, useState, useTransition } from "react"
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
import { estimateClosing, type PeriodMode } from "@/arch/shared/billing-cycle"
import type { CycleProps } from "./dashboard"

/**
 * Estado temporal del período activo: días que faltan para el cierre del ciclo de tarjeta
 * o del mes calendario. El presupuesto y su salud financiera se presentan aparte.
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
              Configura el plan de este período para organizar tus ingresos y gastos.
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
  // daysLeft incluye hoy; el contador muestra días completos hasta la fecha de cierre.
  const remainingDays = Math.max(0, daysLeft - 1)

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
              <span className="tabular text-4xl font-bold tracking-tight">
                {daysLeft === 1 ? "Hoy" : remainingDays}
              </span>
              <span className="font-heading text-lg font-semibold sm:text-xl">
                {daysLeft === 1
                  ? "termina el período"
                  : remainingDays === 1
                    ? "día para cerrar"
                    : "días para cerrar"}
                {/* En crédito, la fecha y si es estimada ya las dicen el ciclo y el botón del cierre. */}
                {cycle.mode === "calendar" && (
                  <span className="tabular-nums"> · {shortDate(cycle.range.end)}.</span>
                )}
              </span>
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground max-sm:pr-32">
              {monthName(period.month)} {period.year} cerró con
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="tabular text-4xl font-bold tracking-tight">
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
        "flex w-full items-center justify-between gap-2 rounded-lg px-4 py-2.5 text-left text-sm transition-colors",
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
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
      {/* El rango que trae el servidor es el del modo guardado: se muestra solo cuando el modo
          guardado y el del switch coinciden en tarjeta. */}
      {cycle.mode === "card_cycle" && card && (
        // En móvil, rango y cierre van en una sola fila (como en escritorio): sin las palabras
        // «Ciclo» y «Cierra el», que el aria-label del botón conserva, cabe en 390 px. El botón va
        // pegado a la derecha, como el switch de abajo.
        <div className="flex w-full min-w-0 items-center justify-between gap-x-3 gap-y-1 sm:w-auto sm:flex-wrap sm:justify-start">
          <p className="min-w-0 truncate text-sm text-muted-foreground">
            <span className="max-sm:sr-only">Ciclo </span>
            <span className="font-medium text-foreground tabular-nums">
              {shortDate(cycle.range.start)} – {shortDate(cycle.range.end)}
            </span>
          </p>
          <ClosingPicker period={period} closing={cycle.closing} />
        </div>
      )}
      {/* En móvil, el switch va en su propia fila a lo ancho: el label a la izquierda y el
          switch pegado a la derecha, en vez de flotar suelto bajo el cierre. */}
      <div className="flex min-h-11 w-full items-center justify-between gap-3 sm:ml-auto sm:w-auto sm:justify-start">
        <Label
          htmlFor={switchId}
          className="cursor-pointer text-base font-medium sm:text-sm"
        >
          {card ? "Modo crédito · ciclo" : "Modo débito · mes"}
        </Label>
        <Switch
          id={switchId}
          aria-describedby={`${switchId}-scope`}
          checked={card}
          disabled={pending}
          onCheckedChange={changeMode}
        />
      </div>
      <p id={`${switchId}-scope`} className="sr-only">Ambos modos incluyen cuenta corriente y tarjeta. Solo cambia el período del plan.</p>
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
          className="h-11 gap-2 px-3 text-sm font-normal sm:h-9"
        >
          <CalendarClock className="size-4 text-muted-foreground" />
          <span>
            <span className="max-sm:sr-only">Cierra el </span>
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
      <PopoverContent align="end" className="w-auto gap-2 p-3">
        <p className="px-1 text-sm text-muted-foreground">Cierre de {mes}</p>
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

