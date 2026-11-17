"use client"

import { useState } from "react"
import { ArrowUpRight, Check, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { linkHost } from "@/lib/schemas/recurring-url"
import { currentPeriod, formatCLP } from "@/lib/finance-format"
import { AppShell } from "./app-shell"
import { Chevron, IconTile, InlineNotice, KeyLine, SectionCard } from "./blocks"
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

// Pantalla Recurrentes: lo que ya está comprometido cada mes, en dos tarjetas (Recurrentes y
// Cuotas), apiladas en móvil y lado a lado desde xl.
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
      {/* Móvil: una columna. xl: Recurrentes y Cuotas lado a lado, de la misma altura (items-stretch),
          con los bordes en la línea de la barra superior (page-container). */}
      <div className="page-container pb-6">
        <div className="grid gap-4 xl:grid-cols-2 xl:items-stretch xl:gap-6">
          {/* Sin botón "Nuevo": una recurrente solo nace de un movimiento (el use case rechaza el
              alta suelta). */}
          <SectionCard
            title="Recurrentes"
            keyLine={
              templates.length > 0 && (
                <KeyLine value={formatCLP(committed)} note="comprometido al mes" />
              )
            }
          >
            {templates.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="flex flex-col gap-4">
                {/* Lo accionable: lo que falta cobrar dentro del mes (hay que reservarlo). */}
                {dueTotal > 0 && (
                  <InlineNotice
                    tone="accent"
                    label="Reserva antes de fin de mes"
                    value={formatCLP(dueTotal)}
                  />
                )}

                {active.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {active.map((t) => (
                      <RecurringRow key={t.id} template={t} onEdit={() => edit(t)} />
                    ))}
                  </ul>
                )}

                {paused.length > 0 && (
                  <RecurringGroup title="Pausadas" count={paused.length} defaultOpen>
                    {paused.map((t) => (
                      <RecurringRow key={t.id} template={t} onEdit={() => edit(t)} />
                    ))}
                  </RecurringGroup>
                )}

                {ended.length > 0 && (
                  <RecurringGroup title="Finalizadas" count={ended.length}>
                    {ended.map((t) => (
                      <RecurringRow key={t.id} template={t} onEdit={() => edit(t)} />
                    ))}
                  </RecurringGroup>
                )}
              </div>
            )}
          </SectionCard>

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

// Subgrupo de la lista (Pausadas, Finalizadas): un <details> nativo con su cuenta; la altura se
// anima desde globals.css y el chevron gira con [open].
function RecurringGroup({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string
  count: number
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="press -mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-callout font-semibold text-ink-2 hover:bg-secondary [&::-webkit-details-marker]:hidden">
        <span className="flex-1">
          {title} <span className="font-normal text-ink-3">· {count}</span>
        </span>
        <Chevron className="group-open:rotate-180" />
      </summary>
      <ul className="mt-1 flex flex-col gap-1">{children}</ul>
    </details>
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
    <li className="press relative -mx-3 flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 has-[>button:hover]:bg-secondary">
      <button
        type="button"
        onClick={onEdit}
        // El nombre accesible es el de antes (nombre, monto y estado); el contenido visible va
        // aria-hidden para que el lector no lo lea dos veces.
        aria-labelledby={`rec-${t.id}-name rec-${t.id}-amount rec-${t.id}-status`}
        className="absolute inset-0 z-1 rounded-[inherit]"
      />
      {/* Decorativo: atenuarlo marca la fila inactiva sin tocar el contraste del texto. */}
      <span aria-hidden className={cn(inactive && "opacity-50")}>
        <IconTile color={t.categoryColor ?? undefined}>
          <CategoryIcon icon={t.categoryIcon} size={18} />
        </IconTile>
      </span>
      <span aria-hidden className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={`rec-${t.id}-name`} className="truncate font-semibold">
          {t.label}
        </span>
        <span className="truncate text-callout text-ink-2">
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
          className="press relative z-2 flex min-h-11 max-w-32 min-w-0 shrink items-center"
        >
          <span className="flex h-8 min-w-0 items-center gap-1 rounded-md bg-secondary px-2 text-caption text-primary hover:bg-primary-soft">
            <span aria-hidden className="truncate max-sm:hidden">
              {linkHost(t.url)}
            </span>
            <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />
          </span>
        </a>
      )}
      <span aria-hidden className="flex shrink-0 flex-col items-end text-right whitespace-nowrap">
        {/* Pausada o finalizada: el monto en tinta 3 (ya no compromete el mes). */}
        <span
          id={`rec-${t.id}-amount`}
          className={cn("font-semibold", inactive && "text-ink-3")}
        >
          {formatCLP(t.baseAmount)}
        </span>
        {t.currentPeriodPaid && !t.hasEnded && t.isActive ? (
          <span
            id={`rec-${t.id}-status`}
            className="flex items-center gap-1 text-caption text-success"
          >
            <Check className="size-3.5" />
            Pagado
          </span>
        ) : (
          status && (
            <span id={`rec-${t.id}-status`} className="text-caption text-ink-3">
              {status}
            </span>
          )
        )}
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
    </li>
  )
}

// Sin alta a mano: la clave con la que se reconoce el cargo sale del cargo real, así que el único
// camino es desde un movimiento.
function EmptyState() {
  return (
    <div className="rounded-lg bg-secondary px-4 py-8 text-center">
      <h3 className="font-semibold">Anticipa lo que ya sabes que vas a pagar</h3>
      <p className="mx-auto mt-1 max-w-sm text-callout text-balance text-ink-2">
        Para crear una, abre el movimiento del cargo y elige{" "}
        <span className="font-semibold text-foreground">Hacer recurrente</span>.
      </p>
    </div>
  )
}
