"use client"

import { startTransition, useOptimistic, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { Button, Glass } from "glisse"
import { MonthPicker, periodLabel } from "./month-picker"

type Period = { year: number; month: number }

/** Selector compartido del período. Glisse dibuja la superficie; la navegación sigue siendo optimista. */
export function MonthNav({
  period,
  current,
  cycleRange,
  onNavigate,
  disabled,
}: {
  period: Period
  current: Period // mes en curso según el modo
  cycleRange?: { start: string; end: string } // rango del ciclo en modo tarjeta
  onNavigate: (year: number, month: number) => void // navega (router.push); va en una transición
  disabled?: boolean
}) {
  const [shown, setShown] = useOptimistic(period)
  // Dirección de la última navegación, derivada en render al cambiar el período mostrado.
  const key = shown.year * 12 + shown.month
  const [anim, setAnim] = useState({ key, dir: 0 })
  if (anim.key !== key) setAnim({ key, dir: key > anim.key ? 1 : -1 })
  const isCurrent = shown.year === current.year && shown.month === current.month

  function go(year: number, month: number) {
    startTransition(() => {
      setShown({ year, month })
      onNavigate(year, month)
    })
  }
  function step(delta: number) {
    haptic("light")
    const d = new Date(Date.UTC(shown.year, shown.month - 1 + delta, 1))
    go(d.getUTCFullYear(), d.getUTCMonth() + 1)
  }

  // Deshabilitado, flechas y etiqueta van a media tinta (`idle-ink`, globals.css): se leen pero no
  // invitan a tocar.
  const arrow = cn(
    "grid size-11 shrink-0 place-items-center rounded-full md:size-10 md:rounded-(--radius-bar-inner)",
    disabled ? "idle-ink" : "press hover:bg-foreground/5"
  )

  return (
    <div
      role={disabled ? "group" : undefined}
      aria-label={disabled ? "Período en curso" : undefined}
      aria-disabled={disabled || undefined}
      className="flex w-full min-w-0 items-center md:w-auto"
    >
      <Glass className="flex min-h-11 min-w-0 flex-1 items-center rounded-full">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={disabled}
          className={arrow}
          aria-label="Mes anterior"
        >
          <ChevronLeft className="size-5 md:size-4" />
        </button>
        <div aria-live="polite" className="flex min-w-0 flex-1 justify-center overflow-hidden">
          {disabled ? (
            <span className="idle-ink flex min-h-11 max-w-full items-center truncate px-3 text-headline font-semibold md:min-h-8 md:text-subheadline">
              {periodLabel(period, cycleRange)}
            </span>
          ) : (
          <span
            key={key}
            className={cn(
              "flex min-w-0 justify-center",
              anim.dir > 0 && "month-in-next",
              anim.dir < 0 && "month-in-prev"
            )}
          >
            <MonthPicker
              period={shown}
              current={current}
              // El rango del ciclo es el de la página: mientras llega la nueva solo se ve el mes.
              cycleRange={
                shown.year === period.year && shown.month === period.month
                  ? cycleRange
                  : undefined
              }
              onSelect={go}
              className="md:rounded-(--radius-bar-inner)"
            />
          </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={disabled}
          className={arrow}
          aria-label="Mes siguiente"
        >
          <ChevronRight className="size-5 md:size-4" />
        </button>
      </Glass>
      {/* «Hoy» entra en la fila: su columna crece de 0 y la cápsula se encoge al mismo ritmo. */}
      <div
        inert={isCurrent}
        className={cn(
          "grid transition-[grid-template-columns,opacity] duration-[260ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
          isCurrent ? "grid-cols-[0fr] opacity-0" : "grid-cols-[1fr] opacity-100"
        )}
      >
        {/* Recorta solo mientras está escondido: abierto, la sombra del vidrio no se corta. */}
        <div className={cn("min-w-0", isCurrent && "overflow-hidden")}>
          <Button
            type="button"
            onClick={() => {
              haptic("light")
              go(current.year, current.month)
            }}
            className="ml-2 whitespace-nowrap"
          >
            Hoy
          </Button>
        </div>
      </div>
    </div>
  )
}
