"use client"

import { Check, Loader } from "lucide-react"
import { cn } from "@/lib/utils"
import { IMPORT_STEPS } from "@/lib/import-progress"

// Timeline vertical de la importación inicial: cada paso pasa de pendiente (círculo tenue) →
// actual (spinner) → hecho (check). Presentacional puro; el paso actual lo decide `importStep`.
export function ImportProgressTimeline({
  current,
  bankName,
}: {
  current: number
  bankName: string
}) {
  return (
    <div className="flex flex-col gap-5 px-6 py-8">
      <div className="text-center">
        <h3 className="text-title font-semibold">
          Conectando {bankName}
        </h3>
        <p className="mt-1 text-callout text-ink-2">
          No cierres esta ventana; toma unos segundos.
        </p>
      </div>

      <ol className="mx-auto flex w-full max-w-sm flex-col gap-1">
        {IMPORT_STEPS.map((step, i) => {
          const done = i < current
          const active = i === current
          return (
            <li key={step.title} className="flex items-start gap-3 py-1.5">
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-md transition-colors duration-300 motion-reduce:transition-none",
                  done && "bg-primary-soft text-primary",
                  active && "bg-secondary text-primary",
                  !done && !active && "bg-secondary text-ink-3"
                )}
              >
                {done ? (
                  <Check className="size-4 animate-in duration-300 zoom-in-50" />
                ) : active ? (
                  <Loader className="size-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              <div
                className={cn(
                  "min-w-0 transition-opacity duration-300",
                  !done && !active && "opacity-45"
                )}
              >
                <div
                  className={cn(
                    "pt-0.5",
                    active && "font-semibold text-foreground",
                    done && "text-foreground"
                  )}
                >
                  {step.title}
                </div>
                {/* El detalle solo del paso en curso: es lo que está pasando ahora. */}
                {active && (
                  <div className="text-callout text-ink-2">
                    {step.detail}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
