"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// Slider de rango: renderiza un thumb por cada valor de `value`/`defaultValue` (uno = simple,
// dos = rango mín/máx). `aria-label` y `aria-valuetext` van a cada thumb, que es el que lleva
// role="slider"; en el Root no los lee nadie.
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": ariaLabel,
  "aria-valuetext": ariaValueText,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex min-h-11 w-full touch-none items-center select-none data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1 w-full grow overflow-hidden rounded-full bg-(--glass-control)"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-primary"
        />
      </SliderPrimitive.Track>
      {values.map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          data-slot="slider-thumb"
          aria-label={
            values.length > 1 && ariaLabel
              ? `${ariaLabel}: ${i === 0 ? "mínimo" : "máximo"}`
              : ariaLabel
          }
          aria-valuetext={ariaValueText}
          // Perilla de iOS: círculo blanco de 28 px con sombra, sólida (sin vidrio).
          className="block size-7 shrink-0 rounded-full bg-(--knob) shadow-(--knob-shadow) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
