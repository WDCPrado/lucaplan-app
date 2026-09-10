"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { currentPeriod, monthName } from "@/lib/finance-format"

// Selector de mes con Popover de shadcn: el pill del mes abre un grid de 12 meses con
// navegación de año. El mes seleccionado va en primary; el mes actual lleva un anillo.
export function MonthPicker({
  period,
  onSelect,
  withYear,
  className,
}: {
  period: { year: number; month: number }
  onSelect: (year: number, month: number) => void
  withYear?: boolean // "octubre 2026" en vez de "octubre": fuera de la topbar el año no es obvio
  className?: string // estilo del botón que abre el selector
}) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(period.year)
  const now = currentPeriod()

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
          className={cn(
            "h-8 min-w-20 rounded-full px-2 text-center text-sm font-semibold transition-colors hover:bg-background",
            className
          )}
        >
          {monthName(period.month)}
          {withYear && <span className="tabular-nums"> {period.year}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" sideOffset={8} className="w-64 p-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            onClick={() => setYear((y) => y - 1)}
            className="grid size-9 place-items-center rounded-full transition-colors hover:bg-accent"
            aria-label="Año anterior"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-semibold tabular-nums">{year}</span>
          <button
            onClick={() => setYear((y) => y + 1)}
            className="grid size-9 place-items-center rounded-full transition-colors hover:bg-accent"
            aria-label="Año siguiente"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const selected = year === period.year && m === period.month
            const isNow =
              year === now.year && m === now.month
            return (
              <button
                key={m}
                onClick={() => {
                  haptic("light")
                  setOpen(false)
                  onSelect(year, m)
                }}
                className={cn(
                  "h-11 rounded-lg text-sm transition-colors md:h-9",
                  selected
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "hover:bg-accent",
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
