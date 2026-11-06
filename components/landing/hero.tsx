"use client"

import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { PlanSummary } from "@/components/finance/financial-health-meter"
import { SpendPaceChart } from "@/components/finance/spend-pace-chart"
import { MovementRow } from "@/components/finance/movement-row"
import { cta, homeMovements, pace, plan } from "./landing-data"

const delay = (ms: number) =>
  ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties

// Hero: el titular a la izquierda y, a la derecha, el Inicio de la app armado con sus componentes
// reales (resumen del plan, curva del ritmo y la lista de movimientos), sobre el fondo agrupado.
export function Hero() {
  return (
    <section
      className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-12 pb-20 lg:grid-cols-[1fr_minmax(0,28rem)] lg:gap-16 lg:px-8 lg:pt-20 lg:pb-28"
    >
      <div className="max-w-xl">
        <h1
          data-reveal
          className="text-[clamp(2.75rem,7vw,4.75rem)] leading-[1.02] font-bold tracking-[-0.035em] text-balance"
        >
          Este mes sí tiene un plan.
        </h1>
        <p
          data-reveal
          style={delay(80)}
          className="mt-6 max-w-md text-title-3 font-normal text-pretty text-muted-foreground"
        >
          Conecta tu correo, la IA ordena tus gastos y sabes cuánto puedes
          gastar hoy. Sin claves bancarias.
        </p>
        <div
          data-reveal
          style={delay(160)}
          className="mt-9 flex flex-wrap items-center gap-3"
        >
          <Link
            href={cta.create.href}
            className="press flex min-h-12 items-center rounded-full bg-primary px-6 text-body font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {cta.create.label}
          </Link>
          <Link
            href={cta.enter.href}
            className="press flex min-h-12 items-center rounded-full bg-(--glass-control) px-6 text-body font-medium hover:bg-foreground/10"
          >
            {cta.enter.label}
          </Link>
        </div>
      </div>

      {/* El Inicio: mismas piezas, mismas clases y mismo orden que el dashboard. */}
      <div
        data-reveal
        style={delay(120)}
        aria-label="Vista de ejemplo del Inicio de Luca Plan"
        role="group"
        className="mx-auto flex w-full max-w-md flex-col gap-4 lg:mx-0"
      >
        <section className="glass flex flex-col rounded-xl p-5">
          <PlanSummary
            {...plan}
            subtitle={`${pace.daysLeft} días para cerrar · 30 nov`}
          />
          <div className="mt-4 flex flex-col">
            <SpendPaceChart
              days={pace.days}
              spend={pace.spend}
              limit={pace.limit}
              income={plan.income}
              lastIndex={pace.lastIndex}
              current
            />
          </div>
          <div className="-mx-5 mt-4 -mb-5 flex min-h-12 items-center justify-between rounded-b-xl border-t border-border px-5 text-body text-primary">
            Ajustar plan
            <ChevronRight aria-hidden className="disclosure" />
          </div>
        </section>
        <div>
          <p className="mb-1.5 px-4 text-footnote tracking-wide text-muted-foreground uppercase">
            Hoy
          </p>
          <div className="glass inset-list overflow-hidden rounded-xl [--inset:4.5rem]">
            {homeMovements.map((tx) => (
              <MovementRow
                key={tx.id}
                tx={tx}
                showRemaining
                className="min-h-11 rounded-none px-4"
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
