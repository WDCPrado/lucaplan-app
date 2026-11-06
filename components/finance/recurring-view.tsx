"use client"

import { useState } from "react"
import { ArrowUpRight, Check, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { linkHost } from "@/lib/schemas/recurring-url"
import { currentPeriod, formatCLP } from "@/lib/finance-format"
import { AppShell } from "./app-shell"
import { CategoryIcon } from "./category-icons"
import { RecurringModal } from "./recurring-modal"
import { InstallmentsSection } from "./installments-view"
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
  templates,
  plans,
  accounts,
  categories,
}: {
  templates: RecurringDTO[]
  plans: InstallmentPlanDTO[]
  accounts: AccountDTO[]
  categories: CategoryDTO[]
}) {
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

  function edit(t: RecurringDTO) {
    setEditing(t)
    setOpen(true)
  }

  return (
    <AppShell>
      {/* En móvil el contenido arranca pegado al header flotante; en escritorio la topbar pide su
          margen. xl: dos columnas de ~30rem, el mínimo en que una fila de recurrente cabe con su
          nombre y el "Ya lo pagué"; por debajo de eso, una columna. */}
      <div className="mx-auto w-full max-w-5xl px-4 pt-1 pb-6 md:pt-6 lg:px-8 xl:max-w-7xl">
        <div className="grid gap-10 xl:grid-cols-2 xl:items-start xl:gap-8">
          <section aria-labelledby="recurrentes-title" className="min-w-0">
            {/* Sin botón "Nuevo": una recurrente solo nace de un movimiento (el use case rechaza el
                alta suelta). min-h-11: mide lo mismo que la cabecera de Cuotas, que lleva su
                acción, para que los títulos queden alineados lado a lado. En móvil el título
                grande ya dice "Recurrentes": el h2 queda para el lector de pantalla. */}
            <div className="mb-2 flex min-h-11 items-center max-md:sr-only">
              <h2 id="recurrentes-title" className="text-title-3 font-bold">
                Recurrentes
              </h2>
            </div>

            {templates.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="flex flex-col gap-6">
                {/* El resumen del mes va primero: es el titular de la sección. Lo accionable es lo
                    que falta cobrar dentro del mes (hay que reservarlo). */}
                <div className="glass rounded-xl p-4">
                  <p className="text-subheadline text-muted-foreground">Total recurrente</p>
                  <p className="tabular text-hero font-bold">{formatCLP(committed)}</p>
                  {dueTotal > 0 && (
                    <p className="mt-2 text-subheadline">
                      Reserva{" "}
                      <strong className="tabular font-semibold">
                        {formatCLP(dueTotal)}
                      </strong>{" "}
                      antes de fin de mes
                    </p>
                  )}
                </div>

                {active.length > 0 && (
                  <ul className="glass inset-list overflow-hidden rounded-xl [--inset:4.25rem]">
                    {active.map((t) => (
                      <RecurringRow
                        key={t.id}
                        template={t}
                        onEdit={() => edit(t)}
                      />
                    ))}
                  </ul>
                )}

                {paused.length > 0 && (
                  <RecurringGroup title="Pausadas">
                    {paused.map((t) => (
                      <RecurringRow key={t.id} template={t} onEdit={() => edit(t)} />
                    ))}
                  </RecurringGroup>
                )}

                {ended.length > 0 && (
                  <RecurringGroup title="Finalizadas">
                    {ended.map((t) => (
                      <RecurringRow key={t.id} template={t} onEdit={() => edit(t)} />
                    ))}
                  </RecurringGroup>
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

// Subgrupo de la lista (Pausadas, Finalizadas): encabezado de lista agrupada de iOS, fuera de
// la tarjeta y alineado con el texto de las filas.
function RecurringGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h3 className="mb-1.5 px-4 text-footnote tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <ul className="glass inset-list overflow-hidden rounded-xl [--inset:4.25rem]">
        {children}
      </ul>
    </section>
  )
}

function RecurringRow({
  template: t,
  onEdit,
}: {
  template: RecurringDTO
  onEdit: () => void
}) {
  const inactive = !t.isActive || t.hasEnded
  const periodicity =
    t.periodicity === "monthly"
      ? null
      : (PERIODICITY_LABEL[t.periodicity] ?? t.periodicity)
  // Pagado del mes = el cargo real ya llegó; manda sobre el "Cobra el …". Pausada: nada.
  const status = t.hasEnded
    ? `Terminó el ${shortDate(t.endDate!)}`
    : t.isActive && !t.currentPeriodPaid
      ? nextChargeLabel(t.nextExecution)
      : null
  return (
    // El enlace no puede ir dentro del botón de la fila: el botón cubre la fila por debajo y el
    // enlace queda encima, así tocarlo abre el portal sin abrir el modal.
    <li className="press relative flex min-h-11 items-center gap-3 py-2.5 pr-4 pl-4 has-[>button:hover]:bg-accent/60 has-[>button:active]:opacity-55">
      <button
        type="button"
        onClick={onEdit}
        aria-label={t.label}
        className="absolute inset-0 rounded-[inherit]"
      />
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full data-inactive:opacity-50"
          style={{
            background: t.categoryColor ? `${t.categoryColor}1f` : "var(--muted)",
          }}
          aria-hidden
          // Decorativo: atenuarlo marca la fila inactiva sin tocar el contraste del texto.
          data-inactive={inactive || undefined}
        >
          <CategoryIcon
            icon={t.categoryIcon}
            size={18}
            color={t.categoryColor ?? undefined}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body">{t.label}</span>
          <span className="block truncate text-footnote text-muted-foreground">
            {t.categoryName}
            {periodicity && ` · ${periodicity}`}
            {/* La vigencia se ve sin abrir el modal: es lo que uno olvida haber fijado. */}
            {t.endDate && !t.hasEnded && ` · hasta ${shortDate(t.endDate)}`}
          </span>
        </span>
        {t.url && (
          <a
            href={t.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Abrir ${linkHost(t.url)}`}
            className="relative flex min-h-11 max-w-32 shrink items-center gap-1 rounded-full px-1 text-footnote text-primary"
          >
            <span className="flex h-7 min-w-0 items-center gap-1 rounded-full bg-(--glass-control) px-2.5">
              <span className="truncate">{linkHost(t.url)}</span>
              <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />
            </span>
          </a>
        )}
        <span className="shrink-0 text-right">
          {/* Pausada o finalizada: el monto en gris secundario (ya no compromete el mes), sin
              atenuar toda la fila, que dejaba el texto secundario bajo 4.5:1. */}
          <span
            className={cn(
              "tabular block text-body font-semibold",
              inactive && "text-muted-foreground"
            )}
          >
            {formatCLP(t.baseAmount)}
          </span>
          {t.currentPeriodPaid && !t.hasEnded && t.isActive ? (
            <span className="flex items-center justify-end gap-1 text-footnote whitespace-nowrap text-primary">
              <Check className="size-3.5" />
              Pagado
            </span>
          ) : (
            status && (
              <span className="block text-footnote whitespace-nowrap text-muted-foreground">
                {status}
              </span>
            )
          )}
        </span>
        {/* La fila abre el detalle: chevron de lista de iOS. */}
        <ChevronRight aria-hidden className="disclosure" />
    </li>
  )
}

// Sin alta a mano: la clave con la que se reconoce el cargo sale del cargo real, así que el único
// camino es desde un movimiento.
function EmptyState() {
  return (
    <div className="glass rounded-xl px-6 py-10 text-center">
      <h3 className="text-headline">Anticipa lo que ya sabes que vas a pagar</h3>
      <p className="mx-auto mt-1 max-w-sm text-subheadline text-balance text-muted-foreground">
        Para crear una, abre el movimiento del cargo y elige{" "}
        <span className="font-medium text-foreground">Hacer recurrente</span>.
      </p>
    </div>
  )
}
