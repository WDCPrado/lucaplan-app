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
        className="relative h-1 w-full grow overflow-hidden rounded-full bg-(--glass-control)"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-primary"
        />
      </SliderPrimitive.Track>
      {ticks > 0 && (
        // Radix mantiene la perilla dentro de la pista: su centro va de media perilla a
        // (ancho − media perilla). Las marcas usan el mismo recorrido para caer bajo ella, y van
        // debajo de la pista como en iOS 26 (la perilla tapa la del paso actual).
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-[1.1875rem] top-[calc(50%+0.4375rem)] h-1"
        >
          {Array.from({ length: ticks }, (_, i) => (
            <span
              key={i}
              className="absolute top-0 size-1 -translate-x-1/2 rounded-full bg-foreground/25"
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
            // Perilla de iOS 26: cápsula de 38×24, clara y sólida en reposo para leerse sobre la
            // pista. Al arrastrar crece un 15 % y se vuelve vidrio; al soltar vuelve con un spring.
            // Reducir movimiento: sin escala. Reducir transparencia: el vidrio cae a sólido (token).
            "block h-6 w-[2.375rem] shrink-0 rounded-full bg-(--knob) shadow-(--knob-shadow)",
            "transition-transform duration-500 ease-(--ease-spring) motion-reduce:transition-none",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none",
            // El simple se activa al tocar cualquier punto (Radix captura el puntero en el Root);
            // en el rango, solo la perilla que se toma, para que la otra no crezca encima.
            single
              ? "group-active/slider:liquid-glass motion-safe:group-active/slider:scale-115"
              : "active:liquid-glass motion-safe:active:scale-115"
          )}
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
