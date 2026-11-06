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
      className="flex flex-1 gap-1.5"
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="h-1 flex-1 overflow-hidden rounded-full bg-border"
        >
          <span
            className={cn(
              "block h-full origin-left rounded-full bg-primary transition-transform duration-500 ease-out motion-reduce:transition-none",
              i <= index ? "scale-x-100" : "scale-x-0"
            )}
          />
        </span>
      ))}
    </div>
  )
}
// Escritorio: la explicación a un lado y la acción al otro. Móvil: una columna.
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
    <div className="grid flex-1 content-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
      <div className="lg:sticky lg:top-10 lg:self-start">
        <p className="text-footnote font-semibold tracking-wide text-primary uppercase">
          {eyebrow}
        </p>
        <h1
          id={TITLE_ID}
          ref={focusOnMount}
          tabIndex={-1}
          className="mt-2 text-title-1 font-bold text-balance outline-none lg:text-large-title"
        >
          {title}
        </h1>
        <p className="mt-3 text-body text-pretty text-muted-foreground">
          {body}
        </p>
        {points && (
          <ul className="mt-6 flex flex-col gap-3">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <Icon
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-primary"
                />
                <span className="text-subheadline text-pretty">{text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
