"use client"

import { cn } from "@/lib/utils"
import { RadioGroup } from "radix-ui"

/**
 * Control segmentado de iOS 26: cápsula, segmentos concéntricos, pista systemFill y el segmento elegido en relleno sólido. Un solo
 * estilo activo para todas las opciones (el color no cambia según qué se elige).
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  className,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string // nombre del grupo para lectores de pantalla
  disabled?: boolean
  className?: string
}) {
  const activeIndex = options.findIndex((o) => o.value === value)
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onChange(next as T)}
      disabled={disabled}
      orientation="horizontal"
      aria-label={label}
      className={cn(
        "relative flex min-h-11 rounded-full bg-(--glass-control) p-0.5",
        className
      )}
    >
      {/* Pastilla clara que se desliza hasta el segmento elegido (spring corto; salta con
          movimiento reducido). Los segmentos miden lo mismo: basta su índice. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0.5 left-0.5 rounded-full bg-(--glass-control-active) shadow-(--knob-shadow) transition-transform duration-500 ease-(--ease-spring) motion-reduce:transition-none",
          activeIndex < 0 && "opacity-0"
        )}
        style={{
          width: `calc((100% - 0.25rem) / ${options.length})`,
          transform: `translateX(${Math.max(activeIndex, 0) * 100}%)`,
        }}
      />
      {options.map((o) => {
        const active = o.value === value
        return (
          <RadioGroup.Item
            value={o.value}
            key={o.value}
            disabled={disabled}
            className={cn(
              "relative flex-1 rounded-full px-3 text-subheadline whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
              active
                ? "font-semibold text-foreground"
                : // En oscuro, muted sobre la pista de una hoja queda en 4.49:1: no llega a AA.
                  "font-medium text-muted-foreground hover:text-foreground dark:text-foreground/80"
            )}
          >
            {o.label}
          </RadioGroup.Item>
        )
      })}
    </RadioGroup.Root>
  )
}
