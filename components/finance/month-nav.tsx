"use client"

import { startTransition, useOptimistic, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { MonthPicker } from "./month-picker"

type Period = { year: number; month: number }

/**
 * Selector de mes/ciclo de la barra superior, el mismo en Inicio y Movimientos. En móvil es una
 * cápsula de vidrio que ocupa todo el ancho libre; en escritorio vive dentro de la topbar (que ya es
 * vidrio), así que ahí lleva el relleno de control, sin vidrio sobre vidrio.
 *
 * El cambio es optimista: la etiqueta se mueve al toque y entra deslizándose desde el lado de la
 * navegación; la página llega después. Fuera del mes en curso aparece «Hoy» en la misma fila y la
 * cápsula le hace sitio.
 */
export function MonthNav({
  period,
  current,
  cycleRange,
  onNavigate,
}: {
  period: Period
  current: Period // mes en curso según el modo
  cycleRange?: { start: string; end: string } // rango del ciclo en modo tarjeta
  onNavigate: (year: number, month: number) => void // navega (router.push); va en una transición
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

  const arrow =
    "press grid size-11 shrink-0 place-items-center rounded-full hover:bg-foreground/5 md:size-10 md:rounded-(--radius-bar-inner)"

  return (
    <div className="flex w-full min-w-0 items-center md:w-auto">
      <div className="flex min-h-11 min-w-0 flex-1 items-center rounded-full max-md:liquid-glass md:min-h-10 md:rounded-(--radius-bar-inner) md:bg-(--glass-control)">
        <button
          type="button"
          onClick={() => step(-1)}
          className={arrow}
          aria-label="Mes anterior"
        >
          <ChevronLeft className="size-5 md:size-4" />
        </button>
        <div className="flex min-w-0 flex-1 justify-center overflow-hidden">
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
        </div>
        <button
          type="button"
          onClick={() => step(1)}
          className={arrow}
          aria-label="Mes siguiente"
        >
          <ChevronRight className="size-5 md:size-4" />
        </button>
      </div>
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
          <button
            type="button"
            onClick={() => {
              haptic("light")
              go(current.year, current.month)
            }}
            className="press ml-2 min-h-11 rounded-full px-4 text-subheadline font-semibold whitespace-nowrap max-md:liquid-glass md:min-h-10 md:rounded-(--radius-bar-inner) md:bg-(--glass-control) md:hover:bg-accent"
          >
            Hoy
          </button>
        </div>
      </div>
    </div>
  )
}
