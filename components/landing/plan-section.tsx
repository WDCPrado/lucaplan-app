"use client"

import { useState } from "react"
import { Check } from "lucide-react"
import { IconTile, ListRow, ProgressBar, SectionCard } from "@/components/finance/blocks"
import { CategoryIcon } from "@/components/finance/category-icons"
import { Segmented } from "@/components/finance/segmented"
import { formatCLP } from "@/lib/finance-format"
import { cn } from "@/lib/utils"
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
  debit: "Mes calendario: 1 al 30 de noviembre",
  credit: "Ciclo de tarjeta: 26 de octubre al 25 de noviembre",
}

// Fila de «Ritmo por categoría» del Inicio: icono de la categoría, nombre, lo que queda (o el exceso)
// y la barra con lo gastado y lo comprometido. El color acompaña al texto, nunca lo reemplaza.
export function CategoryRow({ c }: { c: Cat }) {
  const free = c.limit - c.used - c.committed
  const over = c.used > c.limit
  return (
    <li className="flex min-h-14 items-center gap-3 py-2">
      <IconTile color={c.color}>
        <CategoryIcon icon={c.icon} size={18} />
      </IconTile>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-semibold">{c.name}</span>
          <span
            className={cn(
              "text-callout whitespace-nowrap",
              over ? "text-destructive" : free <= 0 ? "text-warning" : "text-ink-2"
            )}
          >
            {over ? (
              <>
                <span className="font-semibold">{formatCLP(c.used - c.limit)}</span> sobre el tope
              </>
            ) : (
              <>
                quedan <span className="font-semibold">{formatCLP(Math.max(0, free))}</span>
              </>
            )}
          </span>
        </div>
        <ProgressBar
          spending
          value={c.used}
          committed={c.committed}
          max={c.limit}
          label={`Gastado de ${c.name}`}
        />
      </div>
    </li>
  )
}

export function PlanSection() {
  const [mode, setMode] = useState<Mode>("debit")
  const list = mode === "debit" ? categories : creditCategories
  return (
    <>
      <section
        id="plan"
        className="mx-auto grid max-w-6xl scroll-mt-20 gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center lg:gap-16 lg:px-8 lg:py-28"
      >
        <div data-reveal className="max-w-lg">
          <h2 className="landing-title font-semibold text-balance">
            Cada mes parte limpio.
          </h2>
          <p className="mt-5 text-title font-normal text-pretty text-ink-2">
            Un tope para el mes y uno por categoría. Al cerrar, el plan
            reinicia y tus montos se heredan.
          </p>
          <p className="mt-4 text-body text-pretty text-ink-2">
            En débito cuenta el mes calendario; en crédito, el ciclo de tu
            tarjeta. Cada modo guarda su propio plan.
          </p>
        </div>

        <SectionCard
          data-reveal
          style={delay(120)}
          title="Ritmo por categoría"
        >
          <Segmented
            value={mode}
            onChange={setMode}
            label="Modo del período"
            options={[
              { value: "debit", label: "Débito" },
              { value: "credit", label: "Crédito" },
            ]}
          />
          <p aria-live="polite" className="mt-3 text-caption text-ink-3">
            {PERIOD[mode]}
          </p>
          <ul
            key={mode}
            className="mt-2 flex animate-in flex-col fade-in motion-reduce:animate-none"
          >
            {list.map((c) => (
              <CategoryRow key={c.name} c={c} />
            ))}
          </ul>
        </SectionCard>
      </section>

      <section
        id="compromisos"
        className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-16 sm:px-6 lg:px-8 lg:pb-28"
      >
        <div data-reveal className="max-w-2xl">
          <h2 className="landing-title font-semibold text-balance">
            La plata que ya tiene dueño.
          </h2>
          <p className="mt-5 text-title font-normal text-pretty text-ink-2">
            Recurrentes y cuotas que aún no se cobran cuentan como
            comprometido. Lo que ves para gastar ya los descontó.
          </p>
        </div>

        <div className="mt-10 grid gap-3 md:grid-cols-2 md:gap-4">
          <SectionCard data-reveal title="Recurrentes">
            <ul className="flex flex-col gap-1">
              {recurring.map((r) => (
                <li key={r.label}>
                  <ListRow
                    icon={
                      <IconTile color={r.color}>
                        <CategoryIcon icon={r.icon} size={18} />
                      </IconTile>
                    }
                    title={r.label}
                    meta={`${r.meta}, mensual`}
                    value={formatCLP(r.amount)}
                    valueNote={
                      r.paid ? (
                        <span className="flex items-center gap-0.5 text-success">
                          <Check aria-hidden className="size-3.5" />
                          {r.note}
                        </span>
                      ) : (
                        r.note
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard data-reveal style={delay(120)} title="Cuotas">
            <ul className="flex flex-col gap-1">
              {installments.map((p) => (
                <li key={p.label} className="pb-2">
                  <ListRow
                    icon={
                      <IconTile color={p.color}>
                        <CategoryIcon icon={p.icon} size={18} />
                      </IconTile>
                    }
                    title={p.label}
                    meta={p.meta}
                    value={formatCLP(p.monthly)}
                    valueNote={
                      p.paid ? (
                        <span className="flex items-center gap-0.5 text-success">
                          <Check aria-hidden className="size-3.5" />
                          Pagada
                        </span>
                      ) : (
                        `quedan ${formatCLP(p.outstanding)}`
                      )
                    }
                  />
                  <ProgressBar
                    value={p.progress}
                    max={100}
                    label={`Cuotas pagadas de ${p.label}`}
                    className="ml-12"
                  />
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>

        <p data-reveal className="mt-5 text-callout text-pretty text-ink-2">
          Este mes:{" "}
          <span className="font-semibold whitespace-nowrap text-committed">
            {formatCLP(plan.committed)}
          </span>{" "}
          <span className="text-committed">comprometidos</span> ({formatCLP(plan.recurringPending)} en recurrentes y{" "}
          {formatCLP(plan.installmentsPending)} en cuotas).
        </p>
      </section>
    </>
  )
}
