"use client"

import { useState } from "react"
import { Check, ChevronRight, Plus } from "lucide-react"

import { cn } from "@/lib/utils"
import { currentPeriod, formatCLP } from "@/lib/finance-format"
import { CategoryIcon } from "./category-icons"
import {
  Chevron,
  IconTile,
  KeyLine,
  ProgressBar,
  SectionAction,
  SectionCard,
} from "./blocks"
import { InstallmentModal } from "./installment-modal"
import { InstallmentPlanModal } from "./installment-plan-modal"
import { Button } from "@/components/ui/button"
import type {
  AccountDTO,
  CategoryDTO,
  InstallmentPlanDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC", // @db.Date es medianoche UTC: en local (Chile) mostraría el día anterior
  })
}

function isThisMonth(iso: string): boolean {
  const d = new Date(iso)
  const t = currentPeriod()
  return d.getUTCFullYear() === t.year && d.getUTCMonth() + 1 === t.month
}

// Cuota vigente del plan: la del próximo vencimiento. Es el monto que golpea el mes, que es lo
// que se pregunta acá; el total del plan se paga en meses que ya no son este.
function currentItem(p: InstallmentPlanDTO) {
  return (
    p.items.find((i) => i.dueDate === p.nextDueDate) ??
    p.items.find((i) => i.status === "upcoming" || i.status === "overdue")
  )
}

// ¿La cuota que vence este mes ya está saldada (pagada o registrada antes de la conexión)?
function thisMonthSettled(p: InstallmentPlanDTO): boolean {
  const item = p.items.find((i) => isThisMonth(i.dueDate))
  return !!item && (item.status === "paid" || item.status === "outside_app")
}

// Tarjeta "Cuotas" de la pantalla Recurrentes. El AppShell y la sesión son de la página que la
// contiene.
export function InstallmentsSection({
  plans,
  accounts,
  categories,
}: {
  plans: InstallmentPlanDTO[]
  accounts: AccountDTO[]
  categories: CategoryDTO[]
}) {
  const [creating, setCreating] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  // Derivado de las props frescas (no un snapshot en estado): tras una mutación del modal +
  // router.refresh(), el detalle muestra el plan actualizado, no el de cuando se abrió.
  const detail = detailId
    ? (plans.find((p) => p.id === detailId) ?? null)
    : null

  const active = plans.filter((p) => p.completedAt === null)
  const done = plans.filter((p) => p.completedAt !== null)
  // Lo que falta pagar en total: la pregunta que trae a alguien a esta sección.
  const debt = active.reduce((sum, p) => sum + p.outstanding, 0)
  // Lo que cargan las cuotas ESTE mes: el dato que se compara contra el presupuesto.
  const monthTotal = active.reduce(
    (sum, p) =>
      sum +
      p.items
        .filter((i) => isThisMonth(i.dueDate))
        .reduce((s, i) => s + (i.paidAmount ?? i.amount), 0),
    0
  )

  return (
    // scroll-mt: los enlaces a /recurring#cuotas no quedan bajo el header fijo.
    <SectionCard
      id="cuotas"
      className="scroll-mt-24"
      title="Cuotas"
      // Crear un plan es la acción de la tarjeta. Vacía, el CTA es el del empty state.
      action={
        plans.length > 0 && (
          <SectionAction onClick={() => setCreating(true)}>
            <Plus /> Nueva compra
          </SectionAction>
        )
      }
      keyLine={
        plans.length > 0 && <KeyLine value={formatCLP(monthTotal)} note="en cuotas este mes" />
      }
    >
      {plans.length === 0 ? (
        <EmptyState onCreate={() => setCreating(true)} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Lo que falta pagar en total: deuda, no caja. */}
          <p className="-mt-1 flex items-baseline justify-between gap-3 text-callout">
            <span className="text-ink-2">Deuda total restante</span>
            <span className="font-semibold whitespace-nowrap">{formatCLP(debt)}</span>
          </p>

          {active.length > 0 && (
            <ul className="flex flex-col gap-1">
              {active.map((p) => (
                <PlanRow key={p.id} plan={p} onOpen={() => setDetailId(p.id)} />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <details className="group">
              <summary className="press -mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-callout font-semibold text-ink-2 hover:bg-secondary [&::-webkit-details-marker]:hidden">
                <span className="flex-1">
                  Pagadas <span className="font-normal text-ink-3">· {done.length}</span>
                </span>
                <Chevron className="group-open:rotate-180" />
              </summary>
              <ul className="mt-1 flex flex-col gap-1">
                {done.map((p) => (
                  <PlanRow key={p.id} plan={p} onOpen={() => setDetailId(p.id)} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {creating && (
        <InstallmentModal
          open
          onOpenChange={setCreating}
          accounts={accounts}
          categories={categories}
          kind="loan"
        />
      )}
      {detail && (
        <InstallmentPlanModal
          key={detail.id}
          open
          onOpenChange={(o) => !o && setDetailId(null)}
          plan={detail}
        />
      )}
    </SectionCard>
  )
}

function PlanRow({
  plan: p,
  onOpen,
}: {
  plan: InstallmentPlanDTO
  onOpen: () => void
}) {
  const completed = p.completedAt !== null
  const item = currentItem(p)
  const monthPaid = !completed && thisMonthSettled(p)
  const overdue = completed ? 0 : p.items.filter((i) => i.status === "overdue").length

  // Nombre y avance (4/12 con su barra) a la izquierda; la cuota del mes y su estado a la derecha.
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="press -mx-3 flex min-h-16 w-[calc(100%+1.5rem)] items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-secondary"
      >
        <span aria-hidden className={cn(completed && "opacity-50")}>
          <IconTile color={p.categoryColor ?? undefined}>
            <CategoryIcon icon={p.categoryIcon} size={18} />
          </IconTile>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-semibold">{p.description}</span>
          {completed ? (
            <span className="text-callout text-ink-2">
              {p.installmentsCount} de {p.installmentsCount} cuotas
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {/* El texto 4/12 ya lo dice para lectores de pantalla; la barra es apoyo visual. */}
              {p.installmentsCount > 0 && (
                <span aria-hidden className="block w-full max-w-28 flex-1">
                  <ProgressBar
                    value={p.settledCount}
                    max={p.installmentsCount}
                    label={`Cuotas pagadas de ${p.description}`}
                  />
                </span>
              )}
              <span className="shrink-0 text-callout text-ink-2">
                <span className="sr-only">cuota </span>
                {p.settledCount}/{p.installmentsCount}
              </span>
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end text-right whitespace-nowrap">
          {/* La cuota del mes manda: el total del plan se paga en meses que no son este. Pagada,
              el total del plan. */}
          <span className={cn("font-semibold", completed && "text-ink-3")}>
            {formatCLP(completed ? p.totalAmount : item ? item.amount : p.outstanding)}
          </span>
          {/* Atrasada manda sobre pagada: es lo que hay que resolver. */}
          {!completed &&
            (overdue > 0 ? (
              <span className="text-caption font-semibold text-destructive">
                {overdue === 1 ? "Atrasada" : `${overdue} atrasadas`}
              </span>
            ) : monthPaid ? (
              <span className="flex items-center gap-1 text-caption text-success">
                <Check className="size-3.5" />
                Pagada
              </span>
            ) : (
              p.nextDueDate && (
                <span className="text-caption text-ink-3">vence {shortDate(p.nextDueDate)}</span>
              )
            ))}
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
      </button>
    </li>
  )
}

// Empty state: qué resuelve y el CTA.
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-lg bg-secondary px-4 py-8 text-center">
      <h3 className="font-semibold">Reparte una deuda en los meses que dura</h3>
      <p className="mx-auto mt-1 max-w-sm text-callout text-balance text-ink-2">
        Una compra en cuotas convertida en plan hace que cada mes cargue solo su cuota, y te dice
        cuánto falta de verdad.
      </p>
      <Button onClick={onCreate} className="mt-4">
        <Plus className="size-4" />
        Registrar un crédito
      </Button>
    </div>
  )
}
