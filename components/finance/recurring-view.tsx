"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Repeat, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { authClient } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { currentPeriod, formatCLP } from "@/lib/finance-format"
import { AppShell } from "./app-shell"
import { CategoryIcon } from "./category-icons"
import { RecurringModal } from "./recurring-modal"
import { InstallmentsSection } from "./installments-view"
import { Button } from "@/components/ui/button"
import type {
  AccountDTO,
  CategoryDTO,
  InstallmentPlanDTO,
  RecurringDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

const PERIODICITY_LABEL: Record<string, string> = {
  monthly: "Mensual",
  biweekly: "Quincenal",
  yearly: "Anual",
}

// "Cobra el 20 ago" / "Cobra hoy" / "Cobra mañana": una fecha suelta obliga a calcular mentalmente
// cuán cerca está; la referencia relativa no.
function nextChargeLabel(iso: string): string {
  const date = new Date(iso)
  // La fecha viene de un @db.Date (medianoche UTC): se lee en UTC. `today` es un instante real:
  // se lee en local, que es el día que el usuario tiene en su calendario.
  const dueDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  const t = currentPeriod()
  const todayDay = Date.UTC(t.year, t.month - 1, t.day)
  const days = Math.round((dueDay - todayDay) / 86_400_000)
  if (days === 0) return "Cobra hoy"
  if (days === 1) return "Cobra mañana"
  return `Cobra el ${date.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })}`
}

// "25 ago 2027": el año va SIEMPRE, porque el error típico al fijar el término es equivocarse de
// año y con "25 ago" no hay forma de notarlo.
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC", // @db.Date es medianoche UTC: en local (Chile) mostraría el día anterior
  })
}

// Cae el próximo cobro dentro del mes en curso: lo que todavía hay que reservar antes de que
// termine el mes (el resto ya se cobró y vuelve recién el mes siguiente).
function isThisMonth(iso: string): boolean {
  const d = new Date(iso)
  const t = currentPeriod()
  return d.getUTCFullYear() === t.year && d.getUTCMonth() + 1 === t.month
}

// Pantalla Recurrentes: lo que ya está comprometido cada mes, en dos secciones. Recurrentes y
// Cuotas van lado a lado desde xl (cada una en una columna con su resumen arriba) y apiladas por
// debajo, con Cuotas al final.
export function RecurringView({
  user,
  templates,
  plans,
  accounts,
  categories,
}: {
  user: { name: string; email: string; initial: string }
  templates: RecurringDTO[]
  plans: InstallmentPlanDTO[]
  accounts: AccountDTO[]
  categories: CategoryDTO[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<RecurringDTO | null>(null)
  const [open, setOpen] = useState(false)

  const ended = templates.filter((t) => t.hasEnded)
  const active = templates.filter((t) => t.isActive && !t.hasEnded)
  const paused = templates.filter((t) => !t.isActive && !t.hasEnded)
  // Lo que estas plantillas comprometen en un período completo: responde "¿cuánto de mi
  // presupuesto ya está tomado antes de gastar nada?".
  const committed = active.reduce((sum, t) => sum + t.baseAmount, 0)
  const dueThisMonth = active.filter((t) => isThisMonth(t.nextExecution))
  const dueTotal = dueThisMonth.reduce((sum, t) => sum + t.baseAmount, 0)
  const upcoming = [...active].sort((a, b) =>
    a.nextExecution.localeCompare(b.nextExecution)
  )

  async function signOut() {
    await authClient.signOut()
    router.push("/login")
  }

  function edit(t: RecurringDTO) {
    setEditing(t)
    setOpen(true)
  }

  // "Ya lo pagué": confirma el comprometido del período sin esperar el aviso del banco. Cuando el
  // cargo real llegue por correo, reemplaza esta marca con su monto y su fecha.
  async function togglePaid(t: RecurringDTO, periodPaid: boolean) {
    haptic("light")
    const res = await fetch(`/api/recurring/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ periodPaid }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return toast.error(data.error ?? "No se pudo marcar el cobro")
    }
    toast.success(periodPaid ? "Cobro marcado como pagado" : "Marca deshecha")
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
      title="Recurrentes"
    >
      {/* En móvil el contenido arranca pegado al header flotante; en escritorio la topbar pide su
          margen. xl: dos columnas de ~30rem, el mínimo en que una fila de recurrente cabe con su
          nombre y el "Ya lo pagué"; por debajo de eso, una columna. */}
      <div className="mx-auto w-full max-w-5xl px-4 pt-1 pb-6 lg:px-8 lg:py-6 xl:max-w-7xl">
        <h1 className="sr-only">Recurrentes y cuotas</h1>
        <div className="grid gap-10 xl:grid-cols-2 xl:items-start xl:gap-8">
          <section aria-labelledby="recurrentes-title" className="min-w-0">
            {/* Sin botón "Nuevo": una recurrente solo nace de un movimiento (el use case rechaza el
                alta suelta), y el botón abría un formulario que nunca se podía guardar. El camino
                es abrir el movimiento y elegir "Hacer recurrente". min-h-9: mide lo mismo que la
                cabecera de Cuotas, que sí lleva botón, para que los títulos queden alineados. */}
            <div className="mb-3 flex min-h-9 items-end">
              <h2 id="recurrentes-title" className="font-heading text-lg font-bold">
                Recurrentes
              </h2>
            </div>

            {templates.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="flex flex-col gap-6">
                {/* El resumen del mes va primero: es el titular de la sección. */}
                <div className="glass rounded-xl p-4">
                  <p className="text-sm text-muted-foreground">Total recurrente</p>
                  <p className="tabular text-2xl font-bold">{formatCLP(committed)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {active.length} de {templates.length}{" "}
                    {templates.length === 1 ? "activa" : "activas"}
                  </p>

                  {/* Lo que falta cobrar dentro del mes es lo accionable (hay que reservarlo). Si ya
                      no queda nada, el panel muestra los que vienen en vez de una frase vacía. */}
                  <div className="mt-4 border-t border-border/60 pt-3">
                    <p className="text-sm font-medium">
                      {dueThisMonth.length > 0 ? "Por cobrar este mes" : "Próximos cobros"}
                    </p>
                    {upcoming.length === 0 ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Sin cobros programados.
                      </p>
                    ) : (
                      <>
                        <ul className="mt-1.5 space-y-1.5">
                          {(dueThisMonth.length > 0
                            ? dueThisMonth
                            : upcoming.slice(0, 3)
                          ).map((t) => (
                            <li key={t.id} className="flex justify-between gap-2 text-sm">
                              <span className="min-w-0 truncate text-muted-foreground">
                                {t.label}
                                {dueThisMonth.length === 0 &&
                                  ` · ${nextChargeLabel(t.nextExecution)
                                    .replace("Cobra el ", "")
                                    .replace("Cobra ", "")}`}
                              </span>
                              <span className="tabular shrink-0">
                                {formatCLP(t.baseAmount)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {dueThisMonth.length > 0 && (
                          <p className="mt-2 text-sm">
                            Reserva{" "}
                            <strong className="tabular font-semibold">
                              {formatCLP(dueTotal)}
                            </strong>{" "}
                            antes de fin de mes.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {active.length > 0 && (
                  <ul className="glass divide-y divide-border/50 rounded-xl px-3">
                    {active.map((t) => (
                      <RecurringRow
                        key={t.id}
                        template={t}
                        onEdit={() => edit(t)}
                        onTogglePaid={(paid) => togglePaid(t, paid)}
                      />
                    ))}
                  </ul>
                )}

                {paused.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                      Pausadas
                    </h3>
                    <ul className="glass divide-y divide-border/50 rounded-xl px-3">
                      {paused.map((t) => (
                        <RecurringRow
                          key={t.id}
                          template={t}
                          onEdit={() => edit(t)}
                          onTogglePaid={(paid) => togglePaid(t, paid)}
                        />
                      ))}
                    </ul>
                  </section>
                )}

                {ended.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                      Finalizadas
                    </h3>
                    <ul className="glass divide-y divide-border/50 rounded-xl px-3">
                      {ended.map((t) => (
                        <RecurringRow
                          key={t.id}
                          template={t}
                          onEdit={() => edit(t)}
                          onTogglePaid={(paid) => togglePaid(t, paid)}
                        />
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </section>

          <InstallmentsSection plans={plans} accounts={accounts} categories={categories} />
        </div>
      </div>

      {/* `key` por plantilla: el formulario guarda sus campos en useState, así que hay que
          remontarlo al cambiar de plantilla (o quedaría con los valores del anterior). */}
      {open && editing && (
        <RecurringModal
          key={editing.id}
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
  onTogglePaid,
}: {
  template: RecurringDTO
  onEdit: () => void
  onTogglePaid: (paid: boolean) => void
}) {
  const inactive = !t.isActive || t.hasEnded
  // Marcar el cobro solo tiene sentido con un período abierto. Y solo se deshace lo que marcó el
  // usuario: un cargo que confirmó el banco es un hecho, no una afirmación que se pueda retirar.
  const canMarkPaid = t.isActive && !t.hasEnded && !t.currentPeriodPaid
  const canUndoPaid = t.isActive && !t.hasEnded && t.currentPeriodPaidManually
  const paidLabel = canMarkPaid
    ? "Ya lo pagué"
    : canUndoPaid
      ? "Deshacer"
      : t.currentPeriodPaid
        ? "Lo cobró el banco"
        : "Sin cobros"
  return (
    <li className={cn("flex items-center gap-3 py-2.5", inactive && "opacity-60")}>
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full"
          style={{
            background: t.categoryColor ? `${t.categoryColor}1f` : "var(--muted)",
          }}
          aria-hidden
        >
          <CategoryIcon
            icon={t.categoryIcon}
            size={18}
            color={t.categoryColor ?? undefined}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{t.label}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {t.categoryName} ·{" "}
            {PERIODICITY_LABEL[t.periodicity] ?? t.periodicity}
            {/* La vigencia se ve sin abrir el modal: es lo que uno olvida haber fijado. */}
            {t.endDate && !t.hasEnded && ` · hasta ${shortDate(t.endDate)}`}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block font-semibold">
            {formatCLP(t.baseAmount)}
          </span>
          {/* Cobrado del mes = el cargo real ya llegó; manda sobre el "Cobra el …". */}
          {t.currentPeriodPaid && !t.hasEnded ? (
            <span className="flex items-center justify-end gap-1 text-xs whitespace-nowrap text-primary">
              <Check className="size-3.5" />
              Cobrado
            </span>
          ) : (
            <span className="block text-xs whitespace-nowrap text-muted-foreground">
              {t.hasEnded
                ? `Terminó el ${shortDate(t.endDate!)}`
                : t.isActive
                  ? nextChargeLabel(t.nextExecution)
                  : "Sin cobros"}
            </span>
          )}
        </span>
      </button>
      {/* El banco a veces avisa días después: hasta entonces el gasto sigue como comprometido y el
          presupuesto muestra plata que ya salió. Esto lo cierra sin salir de la lista.
          El control se queda inerte —no desaparece— cuando no hay nada que marcar: escondiéndolo,
          la columna de acciones se desalinearía fila por fila dentro de la misma lista. */}
      <Button
        variant="ghost"
        size="sm"
        disabled={!canMarkPaid && !canUndoPaid}
        onClick={() => onTogglePaid(canMarkPaid)}
        aria-label={`${paidLabel}: ${t.label}`}
        title={paidLabel}
        // Escritorio: la acción con su nombre; en móvil solo el icono, que el ancho es del nombre.
        className="h-11 shrink-0 text-muted-foreground max-md:size-11 max-md:p-0"
      >
        {canUndoPaid ? (
          <Undo2 className="size-4" />
        ) : (
          <Check className="size-4" />
        )}
        <span className="max-md:sr-only">{paidLabel}</span>
      </Button>
      {/* Pausar/reanudar vive en el modal (se abre tocando la fila): es lo excepcional, y su
          botón acá le comía el ancho al nombre en móvil ("Interne…"). */}
    </li>
  )
}

// Empty state que enseña qué resuelve la función y cuál es el único camino para crearla: desde
// un movimiento. No hay alta a mano: la clave con la que se reconoce el cargo sale del cargo real.
function EmptyState() {
  return (
    <div className="glass rounded-xl px-6 py-10 text-center">
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
        banco los cobra, aunque el monto cambie un poco.
      </p>
      <p className="mx-auto mt-4 max-w-sm text-sm">
        Para crear una, abre el movimiento del cargo y elige{" "}
        <span className="font-medium">Hacer recurrente</span>.
      </p>
    </div>
  )
}
