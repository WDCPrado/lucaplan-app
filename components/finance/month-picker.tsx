"use client"

import { useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { currentPeriod, monthName } from "@/lib/finance-format"

// Etiqueta del período: el mes («Octubre») o, en modo tarjeta, el rango del ciclo
// («Ciclo 23 sep – 22 oct»). La misma en el selector y en el MonthNav deshabilitado.
const day = (key: string) =>
  `${key.slice(8, 10)} ${monthName(Number(key.slice(5, 7)))
    .slice(0, 3)
    .toLowerCase()}`
export function periodLabel(
  period: { month: number },
  cycleRange?: { start: string; end: string }
) {
  return cycleRange
    ? `Ciclo ${day(cycleRange.start)} – ${day(cycleRange.end)}`
    : monthName(period.month)
}

// Selector de mes con Popover de shadcn: el pill del mes abre un grid de 12 meses con
// navegación de año. El mes seleccionado va en primary; el mes actual lleva un anillo.
export function MonthPicker({
  period,
  onSelect,
  withYear,
  current,
  className,
  cycleRange,
}: {
  period: { year: number; month: number }
  onSelect: (year: number, month: number) => void
  withYear?: boolean // "octubre 2026" en vez de "octubre": fuera de la topbar el año no es obvio
  current?: { year: number; month: number } // mes en curso según el modo (tarjeta: el 28/09 ya es octubre)
  cycleRange?: { start: string; end: string } // muestra el rango real en modo tarjeta
  className?: string // estilo del botón que abre el selector
}) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(period.year)
  const now = current ?? currentPeriod()
  const selectedMonth = useRef<HTMLButtonElement>(null)

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setYear(period.year) // al abrir, arrancar en el año del período visible
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "press min-h-11 max-w-full truncate rounded-full px-3 text-center text-headline font-semibold md:min-h-8 md:text-subheadline",
            className
          )}
        >
          {periodLabel(period, cycleRange)}
          {withYear && <span className="tabular-nums"> {period.year}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        className="w-64 p-3"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          selectedMonth.current?.focus()
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setYear((y) => y - 1)}
            className="grid size-11 place-items-center rounded-lg transition-colors hover:bg-foreground/10 md:size-9"
            aria-label="Año anterior"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-subheadline font-semibold tabular-nums">
            {year}
          </span>
          <button
            type="button"
            onClick={() => setYear((y) => y + 1)}
            className="grid size-11 place-items-center rounded-lg transition-colors hover:bg-foreground/10 md:size-9"
            aria-label="Año siguiente"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const selected = year === period.year && m === period.month
            const isNow = year === now.year && m === now.month
            return (
              <button
                type="button"
                ref={selected ? selectedMonth : undefined}
                aria-pressed={selected}
                aria-current={isNow ? "date" : undefined}
                aria-label={`${monthName(m)} ${year}`}
                key={m}
                onClick={() => {
                  haptic("light")
                  setOpen(false)
                  onSelect(year, m)
                }}
                className={cn(
                  "h-11 rounded-lg text-subheadline transition-colors md:h-9",
                  selected
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "hover:bg-foreground/10",
                  !selected && isNow && "ring-1 ring-primary/50"
                )}
              >
                {monthName(m).slice(0, 3)}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
