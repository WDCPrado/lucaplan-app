"use client"

import { ArrowDown, ArrowRight } from "lucide-react"
import { MovementRow } from "@/components/finance/movement-row"
import { rawToCategorized } from "./landing-data"

const delay = (ms: number) =>
  ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties

const points = [
  [
    "Entiende el lenguaje del banco",
    "«Pago:payu *uber eats» es Comida. La IA lee la glosa cruda del aviso y la clasifica.",
  ],
  [
    "Tus categorías explican qué son",
    "Cada una lleva una descripción tuya que la IA usa como contexto.",
  ],
  [
    "Aprende cuando corriges",
    "Si cambias una categoría, te ofrece aplicarla a los movimientos parecidos en un clic.",
  ],
] as const

// Categorización con IA: a la izquierda la glosa tal como llega en el aviso y el movimiento que
// queda; a la derecha qué hace la IA. Sin OPENAI_API_KEY la app sigue sirviendo (sin categorizar).
export function AiSection() {
  return (
    <section
      id="ia"
      className="mx-auto grid max-w-6xl scroll-mt-24 gap-12 px-5 py-20 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:items-center lg:gap-16 lg:px-8 lg:py-28"
    >
      <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1">
        <ol className="glass inset-list overflow-hidden rounded-xl">
          {rawToCategorized.map(({ raw, tx }, i) => (
            <li
              key={tx.id}
              data-reveal
              style={delay(i * 90)}
              className="flex flex-col gap-1 px-4 pt-3 pb-1 sm:flex-row sm:items-center sm:gap-3 sm:py-1"
            >
              <span className="flex min-w-0 items-center gap-2 sm:w-44 sm:shrink-0">
                <span className="truncate font-mono text-footnote text-muted-foreground">
                  {raw}
                </span>
                <ArrowRight aria-hidden className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
                <ArrowDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground sm:hidden" />
              </span>
              <MovementRow tx={tx} className="min-h-11 min-w-0 flex-1 rounded-none px-0" />
            </li>
          ))}
        </ol>
        {/* La pregunta tras recategorizar, con la forma de la alerta de la app. */}
        <div
          data-reveal
          style={delay(450)}
          aria-hidden
          className="material mx-auto w-full max-w-sm rounded-(--radius-sheet) p-5 text-center"
        >
          <p className="text-headline font-semibold">
            ¿Aplicar «Comida» a los similares?
          </p>
          <p className="mt-1 text-footnote text-muted-foreground">
            Hay 8 movimientos más con «uber eats». Luca Plan recordará tu
            elección.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <span className="grid min-h-11 place-items-center rounded-full bg-(--glass-control) text-body">
              Solo este
            </span>
            <span className="grid min-h-11 place-items-center rounded-full bg-primary text-body font-semibold text-primary-foreground">
              Aplicar
            </span>
          </div>
        </div>
      </div>

      <div data-reveal className="order-1 max-w-lg lg:order-2">
        <h2 className="text-[clamp(2rem,4.5vw,3rem)] leading-[1.05] font-bold tracking-[-0.03em] text-balance">
          Se ordena solo. Y aprende de ti.
        </h2>
        <dl className="mt-8 grid gap-6">
          {points.map(([title, body]) => (
            <div key={title}>
              <dt className="text-headline font-semibold">{title}</dt>
              <dd className="mt-1 text-body text-pretty text-muted-foreground">
                {body}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-footnote text-muted-foreground">
          La IA es opcional: sin ella la app funciona igual y los movimientos
          quedan sin categorizar.
        </p>
      </div>
    </section>
  )
}
