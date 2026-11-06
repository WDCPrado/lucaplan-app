"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  CATEGORY_COLOR_LABELS,
  CATEGORY_COLORS,
  CATEGORY_ICONS,
} from "./category-icons"

// Icono y color de una categoría: lo comparten el modal de categoría y el editor del onboarding.
// Un color guardado fuera de la paleta (dato viejo) se suma al final para que siga elegido.
export function CategoryAppearancePicker({
  icon,
  color,
  onIconChange,
  onColorChange,
}: {
  icon: string | null | undefined
  color: string | null | undefined
  onIconChange: (icon: string) => void
  onColorChange: (color: string) => void
}) {
  const palette =
    color && !CATEGORY_COLORS.includes(color)
      ? [...CATEGORY_COLORS, color]
      : CATEGORY_COLORS
  return (
    <>
      <fieldset className="space-y-3">
        <legend className="text-subheadline font-medium">Icono</legend>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
          {CATEGORY_ICONS.map(({ name, label, Icon }) => (
            <Button
              key={name}
              type="button"
              variant="outline"
              className={cn(
                "size-11",
                icon === name && "border-primary bg-primary/10 text-primary"
              )}
              aria-label={label}
              aria-pressed={icon === name}
              onClick={() => onIconChange(name)}
            >
              <Icon aria-hidden size={18} />
            </Button>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-subheadline font-medium">Color</legend>
        <div className="flex flex-wrap gap-2">
          {palette.map((value) => (
            <button
              type="button"
              key={value}
              aria-label={CATEGORY_COLOR_LABELS[value] ?? "Color actual"}
              aria-pressed={color === value}
              onClick={() => onColorChange(value)}
              className={cn(
                "grid size-11 place-items-center rounded-lg border",
                color === value && "border-foreground"
              )}
            >
              <span
                aria-hidden
                className="size-6 rounded-full"
                style={{ backgroundColor: value }}
              />
            </button>
          ))}
        </div>
      </fieldset>
    </>
  )
}
