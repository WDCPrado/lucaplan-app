import type { ReactNode } from "react"
import type { Mail } from "lucide-react"
import { cn } from "@/lib/utils"

// Piezas de los flujos de pantalla completa por pasos: el onboarding y la instalación (/setup).

export const TITLE_ID = "onboarding-title"

// Cada paso enfoca su título al montarse (va con key={step}). Función estable: no se repite en cada render.
export const focusOnMount = (el: HTMLElement | null) =>
  el?.focus({ preventScroll: true })

export function Progress({
  index,
  total,
  label = "Progreso del inicio",
}: {
  index: number
  total: number
  label?: string
}) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={index + 1}
      aria-valuetext={`Paso ${index + 1} de ${total}`}
      aria-label={label}
      className="flex flex-1 gap-1"
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="h-1 flex-1 overflow-hidden rounded-full bg-track"
        >
          <span
            className={cn(
              "block h-full origin-left rounded-full bg-primary transition-transform duration-240 ease-(--ease-out) motion-reduce:transition-none",
              i <= index ? "scale-x-100" : "scale-x-0"
            )}
          />
        </span>
      ))}
    </div>
  )
}
// Ancho de los flujos por pasos (onboarding e instalación): una columna centrada, margen 16.
export const FLOW_COLUMN = "mx-auto w-full max-w-md px-4"

// Un paso: qué es (etiqueta), el título, una línea que lo explica y luego la decisión. Una columna
// en todos los anchos: una decisión por pantalla.
export function Split({
  eyebrow,
  title,
  body,
  points,
  children,
}: {
  eyebrow: string
  title: string
  body: string
  points?: { icon: typeof Mail; text: string }[]
  children: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <p className="text-callout font-semibold text-ink-3">{eyebrow}</p>
        <h1
          id={TITLE_ID}
          ref={focusOnMount}
          tabIndex={-1}
          className="mt-1 text-title font-semibold text-balance outline-none"
        >
          {title}
        </h1>
        <p className="mt-2 text-callout text-pretty text-ink-2">{body}</p>
        {points && (
          <ul className="mt-4 flex flex-col gap-3 rounded-xl bg-card p-(--pad-card)">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                <span className="text-callout text-pretty">{text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  )
}

// La acción principal del paso. En móvil queda fija abajo (sticky: está en el flujo, así que al final
// del scroll no tapa nada) sobre una franja de papel; desde md vuelve a su lugar.
export function StepActions({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 -mx-4 mt-auto flex flex-col gap-2 bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] max-md:shadow-[0_-12px_12px_-4px_var(--background)] md:static md:mx-0 md:px-0 md:pt-2 md:pb-0 md:shadow-none",
        className
      )}
    >
      {children}
    </div>
  )
}
