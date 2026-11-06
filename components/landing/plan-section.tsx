"use client"

import { useState } from "react"
import { Check } from "lucide-react"
import { Segmented } from "@/components/finance/segmented"
import { CategoryIcon } from "@/components/finance/category-icons"
import { formatCLP, statusVar } from "@/lib/finance-format"
import {
  categories,
  creditCategories,
  installments,
  plan,
  recurring,
} from "./landing-data"

type Mode = "debit" | "credit"
type Cat = (typeof categories)[number] | (typeof creditCategories)[number]

const delay = (ms: number) =>
  ({ "--reveal-delay": `${ms}ms` }) as React.CSSProperties

const PERIOD: Record<Mode, string> = {
  debit: "Mes calendario · 1 al 30 de noviembre",
  credit: "Ciclo de tarjeta · 26 de octubre al 25 de noviembre",
}

// Fila de «Ritmo por categoría» del Inicio: ícono en cuadrado de color, nombre, una cifra y la barra
// fina con lo gastado sólido y lo comprometido tenue detrás.
function CategoryRow({ c }: { c: Cat }) {
  const pct = Math.min(100, (c.used / c.limit) * 100)
  const commPct = Math.min(100 - pct, (c.committed / c.limit) * 100)
  const free = c.limit - c.used - c.committed
  const status = c.used > c.limit ? "excedido" : pct + commPct >= 80 ? "moderado" : "bueno"
  return (
    <div className="flex min-h-11 items-start gap-3 py-3 pr-4 pl-4">
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-md text-white"
        style={{ background: c.color }}
      >
        <CategoryIcon icon={c.icon} size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-h-7 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-body">{c.name}</span>
          <span
            className={`shrink-0 text-subheadline ${c.used > c.limit ? "text-destructive" : free <= 0 ? "text-warning" : "text-muted-foreground"}`}
          >
            {c.used > c.limit ? (
              <>
                <span className="tabular">{formatCLP(c.used - c.limit)}</span>{" "}
                sobre el tope
              </>
            ) : (
              <>
                quedan <span className="tabular">{formatCLP(Math.max(0, free))}</span>
              </>
            )}
          </span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%`, background: statusVar(status) }}
          />
          <div
            className="h-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{
              width: `${Math.max(0, commPct)}%`,
              background: statusVar(status),
              opacity: 0.35,
            }}
          />
        </div>
      </div>
    </div>
  )
}

function CommitmentIcon({ icon, color }: { icon: string; color: string }) {
  return (
    <span
      aria-hidden
      className="grid size-10 shrink-0 place-items-center rounded-full"
      style={{ background: `${color}1f` }}
    >
      <CategoryIcon icon={icon} size={18} color={color} />
    </span>
  )
}

export function PlanSection() {
  const [mode, setMode] = useState<Mode>("debit")
  const list = mode === "debit" ? categories : creditCategories
  return (
    <>
      <section
        id="plan"
        className="mx-auto grid max-w-6xl scroll-mt-24 gap-12 px-5 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center lg:gap-16 lg:px-8 lg:py-28"
      >
        <div data-reveal className="max-w-lg">
          <h2 className="landing-title text-balance">
            Cada mes parte limpio.
          </h2>
          <p className="mt-5 text-title-3 font-normal text-pretty text-muted-foreground">
            Un tope para el mes y uno por categoría. Al cerrar, el plan
            reinicia y tus montos se heredan.
          </p>
          <p className="mt-4 text-body text-pretty text-muted-foreground">
            En débito cuenta el mes calendario; en crédito, el ciclo de tu
            tarjeta. Cada modo guarda su propio plan.
          </p>
        </div>

        <div data-reveal style={delay(120)} className="flex min-w-0 flex-col gap-3">
          <Segmented
            value={mode}
            onChange={setMode}
            label="Modo del período"
            options={[
              { value: "debit", label: "Débito" },
              { value: "credit", label: "Crédito" },
            ]}
          />
          <p
            aria-live="polite"
            className="px-4 pt-2 text-footnote tracking-wide text-muted-foreground uppercase"
          >
            {PERIOD[mode]}
          </p>
          <div
            key={mode}
            className="glass inset-list animate-in overflow-hidden rounded-xl fade-in [--inset:3.5rem] motion-reduce:animate-none"
          >
            {list.map((c) => (
              <CategoryRow key={c.name} c={c} />
            ))}
          </div>
        </div>
      </section>

      <section
        id="compromisos"
        className="mx-auto max-w-6xl scroll-mt-24 px-5 pb-20 lg:px-8 lg:pb-28"
      >
        <div data-reveal className="max-w-2xl">
          <h2 className="landing-title text-balance">
            La plata que ya tiene dueño.
          </h2>
          <p className="mt-5 text-title-3 font-normal text-pretty text-muted-foreground">
            Recurrentes y cuotas que aún no se cobran cuentan como
            comprometido. Lo que ves para gastar ya los descontó.
          </p>
        </div>

        <div className="mt-12 grid gap-8 md:grid-cols-2">
          <div data-reveal>
            <h3 className="mb-1.5 px-4 text-footnote tracking-wide text-muted-foreground uppercase">
              Recurrentes
            </h3>
            <ul className="glass inset-list overflow-hidden rounded-xl [--inset:4.25rem]">
              {recurring.map((r) => (
                <li key={r.label} className="flex min-h-11 items-center gap-3 px-4 py-2.5">
                  <CommitmentIcon icon={r.icon} color={r.color} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body">{r.label}</span>
                    <span className="block truncate text-footnote text-muted-foreground">
                      {r.meta} · Mensual
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tabular block text-body font-semibold">
                      {formatCLP(r.amount)}
                    </span>
                    <span
                      className={`flex items-center justify-end gap-0.5 text-footnote ${r.paid ? "text-success" : "text-muted-foreground"}`}
                    >
                      {r.paid && <Check aria-hidden className="size-3.5" />}
                      {r.note}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div data-reveal style={delay(120)}>
            <h3 className="mb-1.5 px-4 text-footnote tracking-wide text-muted-foreground uppercase">
              Cuotas
            </h3>
            <ul className="glass inset-list overflow-hidden rounded-xl [--inset:4.25rem]">
              {installments.map((p) => (
                <li key={p.label} className="flex min-h-11 items-center gap-3 px-4 py-3">
                  <CommitmentIcon icon={p.icon} color={p.color} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-body">{p.label}</span>
                      <span className="tabular shrink-0 text-body font-semibold">
                        {formatCLP(p.monthly)}
                      </span>
                    </span>
                    <span className="flex justify-between gap-2 text-footnote text-muted-foreground">
                      <span className="truncate">{p.meta}</span>
                      <span className={p.paid ? "flex items-center gap-0.5 text-success" : "tabular"}>
                        {p.paid ? (
                          <>
                            <Check aria-hidden className="size-3.5" />
                            Pagada
                          </>
                        ) : (
                          `quedan ${formatCLP(p.outstanding)}`
                        )}
                      </span>
                    </span>
                    <span aria-hidden className="mt-2 block h-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="landing-bar block h-full rounded-full bg-primary"
                        style={{ "--bar": `${p.progress}%` } as React.CSSProperties}
                      />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p data-reveal className="mt-6 px-4 text-subheadline text-muted-foreground">
          Este mes:{" "}
          <span className="tabular font-semibold text-foreground">
            {formatCLP(plan.committed)}
          </span>{" "}
          comprometidos ({formatCLP(plan.recurringPending)} en recurrentes y{" "}
          {formatCLP(plan.installmentsPending)} en cuotas).
        </p>
      </section>
    </>
  )
}
