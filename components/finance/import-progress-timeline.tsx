"use client"

import { Check, Loader2 } from "lucide-react"
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
        <h3 className="text-title-3 font-bold">
          Conectando {bankName}
        </h3>
        <p className="mt-1 text-subheadline text-muted-foreground">
          No cierres esta ventana; toma unos segundos.
        </p>
      </div>

      <ol className="mx-auto flex w-full max-w-sm flex-col gap-1">
        {IMPORT_STEPS.map((step, i) => {
          const done = i < current
          const active = i === current
          return (
            <li key={step.title} className="flex items-start gap-3 py-2">
              <span
                className={cn(
                  "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border transition-colors duration-300",
                  done && "border-success bg-success/15 text-success",
                  active && "border-primary bg-primary/10 text-primary",
                  !done && !active && "border-border text-muted-foreground/40"
                )}
              >
                {done ? (
                  <Check className="size-4 animate-in duration-300 zoom-in-50" />
                ) : active ? (
                  <Loader2 className="size-4 animate-spin" />
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
                    "text-body",
                    active && "text-foreground",
                    done && "text-foreground"
                  )}
                >
                  {step.title}
                </div>
                {/* El detalle solo del paso en curso: es lo que está pasando ahora. */}
                {active && (
                  <div className="text-footnote text-muted-foreground">
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
