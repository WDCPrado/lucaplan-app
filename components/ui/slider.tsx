"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// Hasta cuántos pasos se dibujan marcas en la pista: más ya es un continuo y las marcas son ruido.
const MAX_TICK_STEPS = 10

// Slider de rango: renderiza un thumb por cada valor de `value`/`defaultValue` (uno = simple,
// dos = rango mín/máx). `aria-label` y `aria-valuetext` van a cada thumb, que es el que lleva
// role="slider"; en el Root no los lee nadie.
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  step = 1,
  "aria-label": ariaLabel,
  "aria-valuetext": ariaValueText,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]
  const single = values.length === 1
  // Marcas por paso solo en un slider simple de pocos pasos (el nivel de vidrio): el de rango de
  // montos es un continuo y no las lleva.
  const steps = Math.round((max - min) / step)
  const ticks = single && steps > 0 && steps <= MAX_TICK_STEPS ? steps + 1 : 0

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      step={step}
      className={cn(
        "group/slider relative flex min-h-11 w-full touch-none items-center select-none data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-track"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-primary"
        />
      </SliderPrimitive.Track>
      {ticks > 0 && (
        // Radix mantiene la perilla dentro de la pista: su centro va de media perilla a
        // (ancho − media perilla). Las marcas usan el mismo recorrido y van bajo la pista.
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-3 top-[calc(50%+0.5rem)] h-1"
        >
          {Array.from({ length: ticks }, (_, i) => (
            <span
              key={i}
              className="absolute top-0 size-1 -translate-x-1/2 rounded-full bg-ink-3/50"
              style={{ left: `${(i / (ticks - 1)) * 100}%` }}
            />
          ))}
        </span>
      )}
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
          className={cn(
            // Perilla redonda de 24 en superficie con anillo de acento; al arrastrar crece un 10 %.
            // Reducir movimiento: sin escala.
            "block size-6 shrink-0 rounded-full border-2 border-primary bg-card shadow-[0_1px_3px_rgb(0_0_0/0.2)]",
            "transition-transform duration-150 ease-(--ease-out) motion-reduce:transition-none",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none",
            // El simple se activa al tocar cualquier punto (Radix captura el puntero en el Root);
            // en el rango, solo la perilla que se toma, para que la otra no crezca encima.
            single
              ? "motion-safe:group-active/slider:scale-110"
              : "motion-safe:active:scale-110"
          )}
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
