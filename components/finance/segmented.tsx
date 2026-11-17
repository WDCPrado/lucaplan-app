"use client"

import { cn } from "@/lib/utils"
import { RadioGroup } from "radix-ui"

/**
 * Control segmentado: una sola superficie de tono (surface-2, radio 8, alto --ctl) con el segmento
 * elegido en superficie que se desliza. Un solo estilo activo para todas las opciones (el color no
 * cambia según qué se elige).
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
        "relative flex min-h-(--ctl) rounded-md bg-secondary p-1",
        className
      )}
    >
      {/* Segmento elegido: superficie que se desliza hasta él (salta con movimiento reducido).
          Los segmentos miden lo mismo: basta su índice. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-1 left-1 rounded-sm bg-card shadow-[0_1px_2px_rgb(0_0_0/0.08)] transition-transform duration-240 ease-(--ease-out) motion-reduce:transition-none",
          activeIndex < 0 && "opacity-0"
        )}
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
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
              "relative flex-1 rounded-sm px-3 text-callout font-semibold whitespace-nowrap transition-colors disabled:opacity-45",
              active
                ? "text-foreground"
                : "text-ink-2 hover:text-foreground"
            )}
          >
            {o.label}
          </RadioGroup.Item>
        )
      })}
    </RadioGroup.Root>
  )
}
