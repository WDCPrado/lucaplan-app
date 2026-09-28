"use client"

import { useState } from "react"
import { Check, CreditCard, Plus } from "lucide-react"

import { cn } from "@/lib/utils"
import { currentPeriod, formatCLP } from "@/lib/finance-format"
import { CategoryIcon } from "./category-icons"
import { InstallmentModal } from "./installment-modal"
import { InstallmentPlanModal } from "./installment-plan-modal"
import { Button } from "@/components/ui/button"
import type {
  AccountDTO,
  CategoryDTO,
  InstallmentPlanDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

const KIND_LABEL: Record<string, string> = {
  card: "Tarjeta",
  loan: "Crédito",
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC", // @db.Date es medianoche UTC: en local (Chile) mostraría el día anterior
  })
}

// "septiembre 2026": el final del plan se lee mejor por mes que por día exacto.
function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
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
  const lastDue = active
    .flatMap((p) => p.items.filter((i) => i.status !== "paid"))
    .map((i) => i.dueDate)
    .sort()
    .at(-1)

  return (
    // scroll-mt: los enlaces a /recurring#cuotas no quedan bajo el header fijo.
    <section id="cuotas" aria-labelledby="cuotas-title" className="min-w-0 scroll-mt-24">
      {/* min-h-9: la fila mide lo mismo con o sin el botón, así los títulos de las dos secciones
          quedan alineados cuando van lado a lado. */}
      <div className="mb-3 flex min-h-9 items-end justify-between gap-3">
        <h2 id="cuotas-title" className="font-heading text-lg font-bold">
          Cuotas
        </h2>
        {/* Crear un plan vive acá, en la cabecera de su sección: el "+" de la barra es el ingreso
            rápido de movimientos y es igual en toda la app. Vacía, el CTA es el del empty state. */}
        {plans.length > 0 && (
          <Button onClick={() => setCreating(true)} className="shrink-0">
            <Plus className="size-4" />
            Nueva compra
          </Button>
        )}
      </div>

      {plans.length === 0 ? (
        <EmptyState onCreate={() => setCreating(true)} />
      ) : (
        <div className="flex flex-col gap-6">
          {/* El resumen del mes va primero: es el titular de la sección. */}
          <div className="glass rounded-xl p-4">
            <p className="text-sm text-muted-foreground">Pagas en cuotas este mes</p>
            <p className="tabular text-2xl font-bold">{formatCLP(monthTotal)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {active.length}{" "}
              {active.length === 1 ? "compra activa" : "compras activas"}
            </p>
            <div className="mt-4 space-y-2 border-t border-border/60 pt-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Deuda total restante</span>
                <span className="tabular font-semibold">{formatCLP(debt)}</span>
              </div>
              {lastDue && (
                <p className="text-muted-foreground">
                  La última cuota vence en {monthYear(lastDue)}.
                </p>
              )}
            </div>
          </div>

          {active.length > 0 && (
            <ul className="glass divide-y divide-border/50 rounded-xl px-3">
              {active.map((p) => (
                <PlanRow key={p.id} plan={p} onOpen={() => setDetailId(p.id)} />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                Pagadas
              </h3>
              <ul className="glass divide-y divide-border/50 rounded-xl px-3">
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
  const pct = Math.round((p.settledCount / p.installmentsCount) * 100)
  const item = currentItem(p)
  const monthPaid = !completed && thisMonthSettled(p)
  const endsOn = p.items.at(-1)?.dueDate

  return (
    <li className={cn(completed && "opacity-60")}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full gap-3 py-3 text-left"
      >
        <span
          className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full"
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
            <span className="min-w-0 truncate font-medium">
              {p.description}
            </span>
            {/* La cuota del mes manda: el total del plan se paga en meses que no son este. */}
            <span className="shrink-0 text-sm whitespace-nowrap">
              {completed || !item ? (
                <span className="tabular font-semibold">
                  {formatCLP(p.outstanding)}
                </span>
              ) : (
                <>
                  <span className="tabular font-semibold">
                    {formatCLP(item.amount)}
                  </span>
                  {/* Pagada del mes = la cuota de este mes ya está saldada; manda sobre "al mes". */}
                  {monthPaid ? (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-primary">
                      <Check className="size-3.5" />
                      Pagada
                    </span>
                  ) : (
                    <span className="ml-1 text-xs text-muted-foreground">
                      al mes
                    </span>
                  )}
                </>
              )}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
            <span>
              {KIND_LABEL[p.kind] ?? p.kind} · cuota {p.settledCount} de{" "}
              {p.installmentsCount}
              {p.nextDueDate &&
                !completed &&
                ` · vence ${shortDate(p.nextDueDate)}`}
              {/* El fin del plan es contexto, no urgencia: en móvil cede el espacio. */}
              {endsOn && !completed && (
                <span className="max-sm:hidden">
                  {` · termina en ${monthYear(endsOn)}`}
                </span>
              )}
            </span>
            {/* Prosa en Geist; solo la cifra en mono. */}
            <span>
              {completed ? (
                "Pagada"
              ) : (
                <>
                  quedan{" "}
                  <span className="tabular">{formatCLP(p.outstanding)}</span>
                </>
              )}
            </span>
          </span>
          {/* El avance cierra la fila: puesto bajo el título parecía un subrayado del nombre. */}
          <span
            className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-muted"
            aria-hidden
          >
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </span>
        </span>
      </button>
    </li>
  )
}

// Empty state que explica qué problema resuelve, no que la lista está vacía.
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="glass rounded-xl px-6 py-10 text-center">
      <span
        className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-primary/10"
        aria-hidden
      >
        <CreditCard className="size-5 text-primary" />
      </span>
      <h3 className="font-medium">Reparte una deuda en los meses que dura</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-balance text-muted-foreground">
        Una compra en cuotas se cobra entera hoy pero se paga durante un año.
        Convertirla en un plan hace que cada mes cargue solo su cuota, y te dice
        cuánto falta de verdad.
      </p>
      <Button onClick={onCreate} className="mt-5">
        <Plus className="size-4" />
        Registrar un crédito
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">
        Las compras con tarjeta se pasan a cuotas desde el propio movimiento.
      </p>
    </div>
  )
}
