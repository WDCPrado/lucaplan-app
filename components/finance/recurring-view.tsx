"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Plus, Repeat } from "lucide-react"
import { toast } from "sonner"

import { authClient } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { formatCLP } from "@/lib/finance-format"
import { AppShell } from "./app-shell"
import { CategoryIcon } from "./category-icons"
import { RecurringModal } from "./recurring-modal"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type {
  AccountDTO,
  CategoryDTO,
  RecurringDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

const PERIODICITY_LABEL: Record<string, string> = {
  monthly: "Mensual",
  biweekly: "Quincenal",
  yearly: "Anual",
}

// "Cobra el 20 ago" / "Cobra hoy" / "Cobra mañana": una fecha suelta obliga a calcular mentalmente
// cuán cerca está; la referencia relativa no.
function nextChargeLabel(iso: string, today = new Date()): string {
  const date = new Date(iso)
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  const days = Math.round((day(date) - day(today)) / 86_400_000)
  if (days === 0) return "Cobra hoy"
  if (days === 1) return "Cobra mañana"
  return `Cobra el ${date.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
  })}`
}

export function RecurringView({
  user,
  templates,
  accounts,
  categories,
}: {
  user: { name: string; email: string; initial: string }
  templates: RecurringDTO[]
  accounts: AccountDTO[]
  categories: CategoryDTO[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<RecurringDTO | null>(null)
  const [open, setOpen] = useState(false)

  const active = templates.filter((t) => t.isActive)
  const paused = templates.filter((t) => !t.isActive)
  // Lo que estas plantillas comprometen en un período completo: responde "¿cuánto de mi
  // presupuesto ya está tomado antes de gastar nada?".
  const committed = active.reduce((sum, t) => sum + t.baseAmount, 0)

  async function signOut() {
    await authClient.signOut()
    router.push("/login")
  }

  function create() {
    setEditing(null)
    setOpen(true)
  }

  function edit(t: RecurringDTO) {
    setEditing(t)
    setOpen(true)
  }

  async function toggleActive(t: RecurringDTO, isActive: boolean) {
    haptic("light")
    const res = await fetch(`/api/recurring/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    })
    if (!res.ok) return toast.error("No se pudo cambiar el estado")
    router.refresh()
  }

  return (
    <AppShell
      user={{
        name: user.name || user.email,
        initial: user.initial,
        email: user.email,
      }}
      active="recurrentes"
      onSignOut={signOut}
      onAdd={create}
      title="Recurrentes"
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
            <h2 className="text-lg font-semibold">Gastos recurrentes</h2>
            {active.length > 0 && (
              <p className="tabular text-sm text-muted-foreground">
                {formatCLP(committed)} comprometidos ·{" "}
                {active.length === 1 ? "1 activa" : `${active.length} activas`}
              </p>
            )}
          </div>
          <Button
            onClick={create}
            className="hidden shrink-0 rounded-full lg:inline-flex"
          >
            <Plus className="size-4" />
            Nueva
          </Button>
        </div>

        {templates.length === 0 ? (
          <EmptyState onCreate={create} />
        ) : (
          <div className="flex flex-col gap-6">
            {active.length > 0 && (
              <ul className="flex flex-col gap-2">
                {active.map((t) => (
                  <RecurringRow
                    key={t.id}
                    template={t}
                    onEdit={() => edit(t)}
                    onToggle={() => toggleActive(t, false)}
                  />
                ))}
              </ul>
            )}

            {paused.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                  Pausadas
                </h3>
                <ul className="flex flex-col gap-2">
                  {paused.map((t) => (
                    <RecurringRow
                      key={t.id}
                      template={t}
                      onEdit={() => edit(t)}
                      onToggle={() => toggleActive(t, true)}
                    />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

      {/* `key` por plantilla: el formulario guarda sus campos en useState, así que hay que
          remontarlo al cambiar de plantilla (o quedaría con los valores del anterior). */}
      {open && (
        <RecurringModal
          key={editing?.id ?? "nueva"}
          open
          onOpenChange={setOpen}
          accounts={accounts}
          categories={categories}
          template={editing}
        />
      )}
    </AppShell>
  )
}

function RecurringRow({
  template: t,
  onEdit,
  onToggle,
}: {
  template: RecurringDTO
  onEdit: () => void
  onToggle: () => void
}) {
  return (
    <li
      className={cn(
        "glass flex items-center gap-3 rounded-2xl py-3 pr-4 pl-3 transition-opacity",
        !t.isActive && "opacity-60"
      )}
    >
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full bg-muted"
          aria-hidden
        >
          <CategoryIcon
            icon={t.categoryIcon}
            size={18}
            color={t.categoryColor ?? undefined}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{t.description}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {t.categoryName} ·{" "}
            {PERIODICITY_LABEL[t.periodicity] ?? t.periodicity}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block font-semibold">
            {formatCLP(t.baseAmount)}
          </span>
          <span className="tabular block text-xs text-muted-foreground">
            {t.isActive ? nextChargeLabel(t.nextExecution) : "Sin cobros"}
          </span>
        </span>
      </button>
      {/* Separado del bloque de datos: es un control, no información. El label describe la acción
          para el lector de pantalla; el estado lo anuncia el propio switch. */}
      <Switch
        checked={t.isActive}
        onCheckedChange={onToggle}
        aria-label={`Recurrencia de ${t.description}`}
        className="ml-1 shrink-0"
      />
    </li>
  )
}

// Empty state que enseña qué resuelve la función, en vez de anunciar el vacío.
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="glass rounded-2xl px-6 py-10 text-center">
      <span
        className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-primary/10"
        aria-hidden
      >
        <Repeat className="size-5 text-primary" />
      </span>
      <h3 className="font-medium">Anticipa lo que ya sabes que vas a pagar</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-balance text-muted-foreground">
        El arriendo, el gasto común o una suscripción quedan reservados en tu
        presupuesto desde que empieza el mes, y se reconocen solos cuando el
        banco los cobra —aunque el monto cambie un poco.
      </p>
      <Button onClick={onCreate} className="mt-5 rounded-full">
        <Plus className="size-4" />
        Crear la primera
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">
        También puedes crearla desde un movimiento, con &quot;Hacer
        recurrente&quot;.
      </p>
    </div>
  )
}
