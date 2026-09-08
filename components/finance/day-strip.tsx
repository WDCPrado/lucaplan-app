"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { formatCLP } from "@/lib/finance-format"

// La altura máxima de una barra se calcula contra el día más caro del mes, ignorando los que
// superan este monto: un arriendo aplastaría al resto y la tira dejaría de contar algo.
const OUTLIER_CLP = 200_000
const MAX_BAR_PX = 56

/**
 * El mes como tira de días: una barra por día con lo gastado, hoy marcado, los días futuros
 * atenuados. Tocar un día lo selecciona (el Inicio lista sus movimientos).
 */
export function DayStrip({
  spendByDay,
  selectedDay,
  today,
  onSelect,
}: {
  spendByDay: number[] // índice = día del mes; length = días del mes + 1
  selectedDay: number
  today: number | null // día de hoy si el mes es el actual; null en otros meses
  onSelect: (day: number) => void
}) {
  const selectedRef = useRef<HTMLButtonElement>(null)
  // En móvil la tira desborda: al montar, el día elegido queda a la vista sin mover la página.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", inline: "center" })
  }, [])

  const amounts = spendByDay.slice(1)
  const max = Math.max(1, ...amounts.filter((a) => a <= OUTLIER_CLP))

  return (
    <div
      role="listbox"
      aria-label="Días del mes"
      className="-mx-4 flex gap-0.5 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0"
    >
      {amounts.map((amount, i) => {
        const day = i + 1
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
            aria-label={`Día ${day}: ${formatCLP(amount)}`}
            title={formatCLP(amount)}
            onClick={() => onSelect(day)}
            className={cn(
              "flex h-24 w-9 shrink-0 flex-col items-center justify-end gap-1.5 rounded-lg px-0.5 pt-1.5 pb-1 transition-colors hover:bg-glass sm:w-auto sm:flex-1",
              selected && "bg-accent"
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
                "text-[11px] tabular-nums text-muted-foreground",
                isToday &&
                  "rounded-full bg-primary px-1.5 py-px font-semibold text-primary-foreground"
              )}
            >
              {day}
            </span>
          </button>
        )
      })}
    </div>
  )
}
