"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { formatCLP, monthName } from "@/lib/finance-format"

// La altura máxima de una barra se calcula contra el día más caro del mes, ignorando los que
// superan este monto: un arriendo aplastaría al resto y la tira dejaría de contar algo.
const OUTLIER_CLP = 200_000
const MAX_BAR_PX = 56

/**
 * El mes como tira de días: una barra por fecha del rango con lo gastado, hoy marcado, los días
 * futuros atenuados. Tocar un día lo selecciona (el Inicio lista sus movimientos). En modo tarjeta
 * el rango cruza dos meses (23 sep – 22 oct): cada día es una fecha, no un número del mes.
 */
export function DayStrip({
  days,
  spend,
  selectedDay,
  today,
  onSelect,
}: {
  days: string[] // fechas "YYYY-MM-DD" del rango, en orden
  spend: number[] // gasto de cada fecha de `days`, mismo índice
  selectedDay: string
  today: string | null // hoy si el mes es el en curso; null en otros meses
  onSelect: (day: string) => void
}) {
  const selectedRef = useRef<HTMLButtonElement>(null)
  // En móvil la tira desborda: al montar, el día elegido queda a la vista sin mover la página.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", inline: "center" })
  }, [])

  const max = Math.max(1, ...spend.filter((a) => a <= OUTLIER_CLP))

  return (
    <div
      role="listbox"
      aria-label="Días del mes"
      // Móvil: la tira desborda y arranca centrada en hoy; el fade en los bordes insinúa que
      // hay más días a los lados. En ancho caben todos y no hace falta.
      className="-mx-4 flex scrollbar-none gap-0.5 overflow-x-auto mask-[linear-gradient(90deg,transparent,black_1.25rem,black_calc(100%-1.25rem),transparent)] px-4 sm:mx-0 sm:mask-none sm:px-0"
    >
      {days.map((day, i) => {
        const amount = spend[i]
        const n = Number(day.slice(8, 10))
        const mon = monthName(Number(day.slice(5, 7))).toLowerCase()
        const selected = day === selectedDay
        const isToday = day === today
        const future = today !== null && day > today
        const height = Math.min(
          MAX_BAR_PX,
          Math.max(2, Math.round((amount / max) * MAX_BAR_PX))
        )
        return (
          <button
            key={day}
            ref={selected ? selectedRef : undefined}
            role="option"
            aria-selected={selected}
            aria-label={`${n} de ${mon}: ${formatCLP(amount)}`}
            title={formatCLP(amount)}
            onClick={() => onSelect(day)}
            className={cn(
              "flex h-24 w-9 shrink-0 flex-col items-center justify-end gap-1.5 rounded-lg px-0.5 pt-1.5 pb-1 transition-colors hover:bg-glass sm:w-auto sm:flex-1",
              selected && "bg-accent ring-1 ring-primary/40"
            )}
          >
            <span
              className={cn(
                "w-full max-w-[18px] rounded-t-[4px] rounded-b-[2px] transition-[height] duration-300",
                future ? "bg-muted-foreground/25" : "bg-primary"
              )}
              style={{ height }}
            />
            <span
              className={cn(
                "text-[11px] text-muted-foreground tabular-nums",
                selected && !isToday && "font-semibold text-foreground",
                isToday &&
                  "rounded-full bg-primary px-1.5 py-px font-semibold text-primary-foreground"
              )}
            >
              {n}
            </span>
          </button>
        )
      })}
    </div>
  )
}
