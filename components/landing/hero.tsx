"use client"

import { ChevronRight } from "lucide-react"
import { ProgressBar, SectionCard, StatTile } from "@/components/finance/blocks"
import { SpendPaceChart } from "@/components/finance/spend-pace-chart"
import { formatCLP } from "@/lib/finance-format"
import { spendingColors } from "@/lib/spending-colors"
import { categories, pace, plan } from "./landing-data"
import { LandingCtas } from "./landing-ctas"
import { CategoryRow } from "./plan-section"

const delay = (ms: number) =>
  ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties

// El tope del mes es la suma de los topes por categoría (los mismos datos de «El plan»).
const tope = categories.reduce((s, c) => s + c.limit, 0)
const used = plan.spent + plan.committed

// Hero: el titular arriba y, debajo, el Inicio de la app armado con sus piezas (la cifra
// protagonista, el ritmo del mes y las categorías) en la misma grilla de columnas parejas.
export function Hero({ signupOpen }: { signupOpen: boolean }) {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-10 pb-16 sm:px-6 lg:px-8 lg:pt-20 lg:pb-28">
      <div className="max-w-3xl">
        <h1 data-reveal className="landing-hero font-semibold text-balance">
          Este mes sí tiene un plan.
        </h1>
        <p
          data-reveal
          style={delay(80)}
          className="mt-5 max-w-xl text-title font-normal text-pretty text-ink-2"
        >
          Conecta tu correo, la IA ordena tus gastos y sabes cuánto puedes
          gastar hoy. Sin claves bancarias.
        </p>
        <div data-reveal style={delay(160)} className="mt-8">
          <LandingCtas signupOpen={signupOpen} />
        </div>
      </div>

      {/* El Inicio: mismas piezas que el dashboard, con datos de ejemplo. */}
      <div
        data-reveal
        style={delay(240)}
        role="group"
        aria-label="Vista de ejemplo del Inicio de Luca Plan"
        className="mt-12 grid items-stretch gap-3 sm:rounded-2xl sm:bg-secondary sm:p-4 md:grid-cols-2 md:gap-4 lg:mt-16 lg:grid-cols-3"
      >
        <SectionCard className="gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-body text-ink-2">Disponible para gastar</p>
            <p className="text-display font-semibold whitespace-nowrap">
              {formatCLP(plan.spendable.amount)}
            </p>
            <p className="text-callout text-ink-2">
              {pace.daysLeft} días para cerrar, el 30 nov
            </p>
          </div>
          <div className="mt-auto flex flex-col gap-2">
            <p className="flex items-baseline justify-between gap-3 text-caption text-ink-3">
              <span>Tope de gasto</span>
              <span className="whitespace-nowrap">
                <b className="font-semibold text-ink-2">{formatCLP(used)}</b> de{" "}
                {formatCLP(tope)}
              </span>
            </p>
            <ProgressBar
              spending
              value={plan.spent}
              committed={plan.committed}
              max={tope}
              label="Gastado y comprometido del tope de gasto"
              className="h-2"
            />
          </div>
          <dl className="grid grid-cols-3 gap-3">
            <StatTile label="Ingresos" value={formatCLP(plan.income)} />
            <StatTile
              label={
                <span className={spendingColors(plan.spent, tope).text}>
                  Gastado
                </span>
              }
              value={
                <span className={spendingColors(plan.spent, tope).text}>
                  {formatCLP(plan.spent)}
                </span>
              }
            />
            <StatTile
              label={<span className="text-committed">Comprometido</span>}
              value={
                <span className="text-committed">
                  {formatCLP(plan.committed)}
                </span>
              }
            />
          </dl>
          {/* En la app abre el plan; aquí es solo la forma. */}
          <span
            aria-hidden
            className="-ml-2 inline-flex min-h-8 items-center gap-1 self-start px-2 text-callout font-semibold text-primary"
          >
            Ajustar plan
            <ChevronRight className="size-4" />
          </span>
        </SectionCard>

        <SectionCard title="Ritmo del mes">
          <div className="mt-auto flex flex-col">
            <SpendPaceChart
              days={pace.days}
              spend={pace.spend}
              limit={pace.limit}
              income={plan.income}
              lastIndex={pace.lastIndex}
              current
            />
          </div>
        </SectionCard>

        <SectionCard title="Categorías" className="md:col-span-2 lg:col-span-1">
          <ul className="flex flex-col">
            {categories.slice(0, 3).map((c) => (
              <CategoryRow key={c.name} c={c} />
            ))}
          </ul>
        </SectionCard>
      </div>
    </section>
  )
}
