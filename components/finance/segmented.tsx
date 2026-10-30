"use client"

import { cn } from "@/lib/utils"

/**
 * Control segmentado de iOS: pista systemFill y el segmento elegido en relleno sólido. Un solo
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
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex min-h-11 gap-0.5 rounded-xl bg-(--glass-control) p-0.5",
        className
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            type="button"
            aria-pressed={active}
            key={o.value}
            disabled={disabled}
            onClick={() => !active && onChange(o.value)}
            className={cn(
              "flex-1 rounded-[calc(var(--radius-xl)-0.125rem)] px-3 text-subheadline whitespace-nowrap transition-colors disabled:opacity-50",
              active
                ? "bg-(--glass-control-active) font-semibold text-foreground shadow-sm"
                : // En oscuro, muted sobre la pista de una hoja queda en 4.49:1: no llega a AA.
                  "text-muted-foreground hover:text-foreground dark:text-foreground/80"
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
