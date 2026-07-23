"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, CreditCard, Plus } from "lucide-react"

import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { formatCLP } from "@/lib/finance-format"
import { AppShell } from "./app-shell"
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
  })
}

export function InstallmentsView({
  user,
  plans,
  accounts,
  categories,
}: {
  user: { name: string; email: string; initial: string }
  plans: InstallmentPlanDTO[]
  accounts: AccountDTO[]
  categories: CategoryDTO[]
}) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  // Derivado de las props frescas (no un snapshot en estado): tras una mutación del modal +
  // router.refresh(), el detalle muestra el plan actualizado, no el de cuando se abrió.
  const detail = detailId
    ? (plans.find((p) => p.id === detailId) ?? null)
    : null

  const active = plans.filter((p) => p.completedAt === null)
  const done = plans.filter((p) => p.completedAt !== null)
  // Lo que falta pagar en total: la pregunta que trae a alguien a esta pantalla.
  const debt = active.reduce((sum, p) => sum + p.outstanding, 0)

  async function signOut() {
    await authClient.signOut()
    router.push("/login")
  }

  return (
    <AppShell
      user={{
        name: user.name || user.email,
        initial: user.initial,
        email: user.email,
      }}
      active="cuotas"
      onSignOut={signOut}
      onAdd={() => setCreating(true)}
      title="Cuotas"
    >
      <div className="mx-auto w-full max-w-2xl px-4 py-6 lg:px-8">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Volver
        </Link>

        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Deudas en cuotas</h2>
            {active.length > 0 && (
              <p className="tabular text-sm text-muted-foreground">
                {formatCLP(debt)} por pagar ·{" "}
                {active.length === 1 ? "1 plan" : `${active.length} planes`}
              </p>
            )}
          </div>
          <Button
            onClick={() => setCreating(true)}
            className="hidden shrink-0 rounded-full lg:inline-flex"
          >
            <Plus className="size-4" />
            Nuevo
          </Button>
        </div>

        {plans.length === 0 ? (
          <EmptyState onCreate={() => setCreating(true)} />
        ) : (
          <div className="flex flex-col gap-6">
            {active.length > 0 && (
              <ul className="flex flex-col gap-2">
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
                <ul className="flex flex-col gap-2">
                  {done.map((p) => (
                    <PlanRow key={p.id} plan={p} onOpen={() => setDetailId(p.id)} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

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
    </AppShell>
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
  return (
    <li className={cn("glass rounded-2xl", completed && "opacity-60")}>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 py-3 pr-4 pl-3 text-left"
      >
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full bg-muted"
          aria-hidden
        >
          <CategoryIcon
            icon={p.categoryIcon}
            size={18}
            color={p.categoryColor ?? undefined}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{p.description}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {KIND_LABEL[p.kind] ?? p.kind} · cuota {p.settledCount} de{" "}
            {p.installmentsCount}
            {p.nextDueDate && !completed && ` · vence ${shortDate(p.nextDueDate)}`}
          </span>
          {/* El avance en barra se lee de un vistazo; el texto de arriba da el detalle exacto. */}
          <span
            className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-muted"
            aria-hidden
          >
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block font-semibold">
            {formatCLP(p.outstanding)}
          </span>
          <span className="block text-xs text-muted-foreground">
            {completed ? "Pagada" : "por pagar"}
          </span>
        </span>
      </button>
    </li>
  )
}

// Empty state que explica qué problema resuelve, no que la lista está vacía.
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="glass rounded-2xl px-6 py-10 text-center">
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
      <Button onClick={onCreate} className="mt-5 rounded-full">
        <Plus className="size-4" />
        Registrar un crédito
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">
        Las compras con tarjeta se pasan a cuotas desde el propio movimiento.
      </p>
    </div>
  )
}
