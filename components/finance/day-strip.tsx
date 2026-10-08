"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { formatCLP, monthName } from "@/lib/finance-format"

// La escala anterior excluye arriendos y otros gastos grandes para que el resto siga legible.
const OUTLIER_CLP = 200_000
const MAX_BAR_PX = 56

/** Gasto por día del ciclo, con selección y desplazamiento limitados a esta tira. */
export function DayStrip({
  days,
  spend,
  selectedDay,
  today,
  onSelect,
}: {
  days: string[]
  spend: number[]
  selectedDay: string
  today: string | null
  onSelect: (day: string) => void
}) {
  const selectedRef = useRef<HTMLButtonElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const strip = stripRef.current
    const selected = selectedRef.current
    if (!strip || !selected) return
    strip.scrollLeft +=
      selected.getBoundingClientRect().left -
      strip.getBoundingClientRect().left -
      (strip.clientWidth - selected.offsetWidth) / 2
  }, [selectedDay])

  const max = Math.max(1, ...spend.filter((amount) => amount <= OUTLIER_CLP))

  return (
    <div
      ref={stripRef}
      role="group"
      aria-label="Días del período"
      className="flex max-w-full [scrollbar-width:none] gap-1 overflow-x-auto overscroll-x-contain py-1 [&::-webkit-scrollbar]:hidden"
    >
      {days.map((day, i) => {
        const selected = day === selectedDay
        const isToday = day === today
        const future = today !== null && day > today
        const date = Number(day.slice(8, 10))
        const month = Number(day.slice(5, 7))
        const amount = spend[i] ?? 0
        const height = Math.min(
          MAX_BAR_PX,
          Math.max(2, Math.round((amount / max) * MAX_BAR_PX))
        )
        return (
          <button
            key={day}
            type="button"
            ref={selected ? selectedRef : undefined}
            tabIndex={
              selected || (!days.includes(selectedDay) && i === 0) ? 0 : -1
            }
            aria-pressed={selected}
            aria-current={isToday ? "date" : undefined}
            aria-label={`${date} de ${monthName(month).toLowerCase()}${isToday ? ", hoy" : ""}${future ? ", futuro" : ""}: ${formatCLP(spend[i] ?? 0)}`}
            title={formatCLP(spend[i] ?? 0)}
            onClick={() => onSelect(day)}
            onKeyDown={(event) => {
              const targetIndex =
                event.key === "ArrowRight"
                  ? Math.min(days.length - 1, i + 1)
                  : event.key === "ArrowLeft"
                    ? Math.max(0, i - 1)
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? days.length - 1
                        : null
              if (targetIndex === null) return
              event.preventDefault()
              onSelect(days[targetIndex])
              const target = stripRef.current?.children[targetIndex] as
                | HTMLButtonElement
                | undefined
              target?.focus({ preventScroll: true })
            }}
            className={cn(
              "flex h-24 w-11 shrink-0 flex-col items-center justify-end gap-1.5 rounded-lg px-0.5 pt-1.5 pb-1 text-sm hover:bg-secondary",
              selected
                ? "bg-accent font-semibold text-primary ring-1 ring-primary ring-inset"
                : "text-foreground",
              future && !selected && "text-muted-foreground"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "w-full max-w-[18px] rounded-t-md rounded-b-sm",
                future ? "bg-muted-foreground/25" : "bg-primary"
              )}
              style={{ height }}
            />
            <span
              className={cn(
                "text-sm tabular-nums",
                selected
                  ? "font-semibold text-primary"
                  : "text-muted-foreground",
                isToday &&
                  "rounded-full bg-primary px-1.5 py-px font-semibold text-primary-foreground"
              )}
            >
              {date}
            </span>
          </button>
        )
      })}
    </div>
  )
}
