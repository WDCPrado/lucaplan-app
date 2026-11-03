"use client"

import { Button } from "glisse"

import { useState } from "react"
import { Check, Plus } from "lucide-react"

import { cn } from "@/lib/utils"
import { currentPeriod, formatCLP } from "@/lib/finance-format"
import { CategoryIcon } from "./category-icons"
import { InstallmentModal } from "./installment-modal"
import { InstallmentPlanModal } from "./installment-plan-modal"

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

// Sección "Cuotas" de la pantalla Recurrentes: una columna con el resumen del mes arriba y la
// lista debajo, porque comparte el ancho con la sección de recurrentes. El AppShell y la sesión
// son de la página que la contiene.
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
    <section id="cuotas" aria-labelledby="cuotas-title" className="min-w-0 scroll-mt-24">
      {/* min-h-11: la fila mide lo mismo con o sin la acción, así los títulos de las dos
          secciones quedan alineados cuando van lado a lado. */}
      <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
        <h2 id="cuotas-title" className="text-title-3 font-bold">
          Cuotas
        </h2>
        {/* Crear un plan es la acción de la sección: texto azul a la derecha del encabezado.
            Vacía, el CTA es el del empty state. */}
        {plans.length > 0 && (
          <Button
            type="button"
            onClick={() => setCreating(true)}
            className="press flex min-h-11 shrink-0 items-center gap-1 text-body text-primary"
          >
            <Plus className="size-4" /> Nueva compra
          </Button>
        )}
      </div>

      {plans.length === 0 ? (
        <EmptyState onCreate={() => setCreating(true)} />
      ) : (
        <div className="flex flex-col gap-6">
          {/* El resumen del mes va primero: lo que cargan las cuotas este mes, y lo que falta. */}
          <div className="glass rounded-xl p-4">
            <p className="text-subheadline text-muted-foreground">Pagas en cuotas este mes</p>
            <p className="tabular text-hero font-bold">{formatCLP(monthTotal)}</p>
            <p className="mt-2 flex justify-between gap-2 text-subheadline">
              <span className="text-muted-foreground">Deuda total restante</span>
              <span className="tabular font-semibold">{formatCLP(debt)}</span>
            </p>
          </div>

          {active.length > 0 && (
            <ul className="glass inset-list overflow-hidden rounded-xl [--inset:4.25rem]">
              {active.map((p) => (
                <PlanRow key={p.id} plan={p} onOpen={() => setDetailId(p.id)} />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <section>
              <h3 className="mb-1.5 px-4 text-footnote tracking-wide text-muted-foreground uppercase">
                Pagadas
              </h3>
              <ul className="glass inset-list overflow-hidden rounded-xl [--inset:4.25rem]">
                {done.map((p) => (
                  <PlanRow key={p.id} plan={p} onOpen={() => setDetailId(p.id)} />
                ))}
              </ul>
            </section>
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
    </section>
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

  // Dos líneas: nombre y cuota del mes; debajo, en qué cuota va y cuándo vence la próxima.
  return (
    <li className={cn(completed && "opacity-60")}>
      <button
        type="button"
        onClick={onOpen}
        className="press flex min-h-11 w-full items-center gap-3 py-2.5 pr-4 pl-4 text-left hover:bg-accent/60"
      >
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full"
          style={{
            background: p.categoryColor ? `${p.categoryColor}1f` : "var(--muted)",
          }}
          aria-hidden
        >
          <CategoryIcon
            icon={p.categoryIcon}
            size={18}
            color={p.categoryColor ?? undefined}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-body">{p.description}</span>
            {/* La cuota del mes manda: el total del plan se paga en meses que no son este. Pagada,
                el total del plan. */}
            <span className="tabular shrink-0 text-body font-semibold">
              {formatCLP(completed ? p.totalAmount : item ? item.amount : p.outstanding)}
            </span>
          </span>
          {!completed && (
            <span className="mt-0.5 flex items-center justify-between gap-3 text-footnote text-muted-foreground">
              <span className="min-w-0 truncate">
                cuota {p.settledCount} de {p.installmentsCount}
                {p.nextDueDate && ` · vence ${shortDate(p.nextDueDate)}`}
              </span>
              {/* La cuota de este mes ya está saldada. */}
              {monthPaid && (
                <span className="flex shrink-0 items-center gap-0.5 text-primary">
                  <Check className="size-3.5" />
                  Pagada
                </span>
              )}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

// Empty state: qué resuelve y el CTA.
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="glass rounded-xl px-6 py-10 text-center">
      <h3 className="text-headline">Reparte una deuda en los meses que dura</h3>
      <p className="mx-auto mt-1 max-w-sm text-subheadline text-balance text-muted-foreground">
        Una compra en cuotas convertida en plan hace que cada mes cargue solo su cuota, y te dice cuánto falta de verdad.
      </p>
      <Button
        variant="filled"
        onClick={onCreate}
        className="mt-5 h-11 text-body"
      >
        <Plus className="size-4" />
        Registrar un crédito
      </Button>
    </div>
  )
}
