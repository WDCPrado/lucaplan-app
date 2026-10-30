"use client"

import { useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ListChecks } from "lucide-react"
import { toast } from "sonner"

import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { useMoneyInput } from "@/hooks/use-money-input"
import { CategoryIcon } from "./category-icons"
import { Chip, DatePicker } from "./transaction-modal"
import { DayOfMonthPicker } from "./income-modal"
import {
  RecurringLinkPicker,
  type CandidateFilters,
} from "./recurring-link-picker"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import type {
  AccountDTO,
  CategoryDTO,
  RecurringDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

// Fecha de término escrita completa, para revisar el año de un vistazo.
function readableEnd(iso: string): string | null {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

const PERIODICITIES = [
  { value: "monthly", label: "Mensual" },
  { value: "biweekly", label: "Quincenal" },
  { value: "yearly", label: "Anual" },
] as const

// Modal de plantilla recurrente (crear/editar). El monto base no es el monto exacto del cargo: es
// el centro del rango ± tolerancia con el que se reconoce el cobro cuando llega por correo.
// Valores con los que se abre el formulario al crear desde un movimiento: la creación nunca es
// directa, el usuario revisa y confirma (el monto del cargo es solo el centro del rango).
export type RecurringPreset = {
  label?: string // nombre inicial editable (por defecto, la descripción del movimiento)
  accountId?: string
  categoryId?: string | null
  baseAmount?: number
  dayOfMonth?: number
  // Movimiento desde el que se abre el formulario: al guardar queda vinculado como la ejecución
  // de su período (así aparece marcado como recurrente y no se duplica el comprometido del mes).
  sourceTransactionId?: string
}

export function RecurringModal({
  open,
  onOpenChange,
  onSaved,
  accounts,
  categories,
  template,
  preset,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved?: () => void
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  template?: RecurringDTO | null // null/undefined = crear
  preset?: RecurringPreset | null // precarga al crear desde un movimiento
}) {
  const router = useRouter()
  // Id por instancia: el botón del pie envía este formulario con `form=`, y un modal anidado
  // puede montar otro igual.
  const formId = `recurring-form-${useId()}`
  const [label, setLabel] = useState(template?.label ?? preset?.label ?? "")
  const [accountId, setAccountId] = useState(
    template?.accountId ?? preset?.accountId ?? accounts[0]?.id ?? ""
  )
  // La categoría siempre viene del movimiento de origen (creación) o de la plantilla (edición):
  // no se elige aquí, es de solo lectura.
  const categoryId = template?.categoryId ?? preset?.categoryId ?? null
  const [tolerancePct, setTolerancePct] = useState(template?.tolerancePct ?? 10)
  const [periodicity, setPeriodicity] = useState<string>(
    template?.periodicity ?? "monthly"
  )
  const [day, setDay] = useState(
    template?.dayOfMonth ?? preset?.dayOfMonth ?? 1
  )
  // Fin de vigencia: vacío = indefinida (nunca termina), que es el caso normal.
  const [endDate, setEndDate] = useState(
    template?.endDate ? template.endDate.slice(0, 10) : ""
  )
  const [withEnd, setWithEnd] = useState(!!template?.endDate)
  const [saving, setSaving] = useState(false)
  // Selector de un movimiento existente como cobro del período. null = cargando.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [candidates, setCandidates] = useState<
    TransactionDTO[] | null | "error"
  >(null)
  const [filters, setFilters] = useState<CandidateFilters>({
    q: "",
    days: 10,
  })
  // Cada carga lleva un número: si cambia un filtro o se reabre la lista antes de que llegue la
  // anterior, la vieja no pisa a la nueva.
  const reqRef = useRef(0)
  const typingRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const inheritedCategory = categories.find((c) => c.id === categoryId)
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
  const money = useMoneyInput(
    (account?.currency as CurrencyCode) ?? "CLP",
    template?.baseAmount ?? preset?.baseAmount ?? 0
  )
  const needsDay = periodicity !== "biweekly"
  const canSave =
    !!label.trim() &&
    !!account &&
    !!categoryId &&
    money.value > 0 &&
    (!needsDay || (day >= 1 && day <= 31)) &&
    !saving

  const min = Math.round(money.value * (1 - tolerancePct / 100))
  const max = Math.round(money.value * (1 + tolerancePct / 100))
  const fmt = (n: number) => n.toLocaleString("es-CL")

  async function save() {
    if (!canSave || !account || !categoryId) return
    setSaving(true)
    const res = await fetch(
      template ? `/api/recurring/${template.id}` : "/api/recurring",
      {
        method: template ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: account.id,
          categoryId,
          label: label.trim(),
          direction: "debit",
          baseAmount: money.value,
          tolerancePct,
          periodicity,
          dayOfMonth: needsDay ? day : null,
          startDate: template?.startDate ?? new Date().toISOString(),
          endDate: endDate || null,
          isActive: template?.isActive ?? true,
          sourceTransactionId: template
            ? undefined
            : preset?.sourceTransactionId,
        }),
      }
    )
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return toast.error(data.error ?? "No se pudo guardar la recurrente")
    }
    haptic("success")
    toast.success(template ? "Recurrente actualizada" : "Recurrente creada")
    onOpenChange(false)
    onSaved?.()
    router.refresh()
  }

  // Cambio de estado de la plantilla. Cierra el modal como las demás acciones — el estado nuevo
  // se ve en la fila, que sí se refresca.
  async function patch(body: object, ok: string, fail: string) {
    if (!template || saving) return
    setSaving(true)
    const res = await fetch(`/api/recurring/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return toast.error(data.error ?? fail)
    }
    haptic("success")
    toast.success(ok)
    setPickerOpen(false)
    onOpenChange(false)
    router.refresh()
  }

  // Deshace el "Ya lo pagué" de la fila. Solo lo marcado a mano: un cargo del banco es un hecho.
  function undoPaid() {
    patch({ periodPaid: false }, "Marca deshecha", "No se pudo deshacer la marca")
  }

  // El cargo llegó con otra fecha y no se enganchó solo: se elige a mano entre los gastos sueltos.
  // Se carga al abrir y en cada cambio de filtro, desde el evento, sin efecto.
  async function loadCandidates(f: CandidateFilters) {
    if (!template) return
    const id = ++reqRef.current
    setCandidates(null)
    const params = new URLSearchParams({ days: String(f.days) })
    if (f.q.trim()) params.set("q", f.q.trim())
    try {
      const res = await fetch(
        `/api/recurring/${template.id}/candidates?${params}`
      )
      if (!res.ok) throw new Error()
      const data: { items: TransactionDTO[] } = await res.json()
      if (id !== reqRef.current) return
      setCandidates(data.items)
    } catch {
      if (id !== reqRef.current) return
      setCandidates("error")
    }
  }

  function openPicker() {
    setPickerOpen(true)
    loadCandidates(filters)
  }

  // El texto y los días escritos esperan 300 ms a que se deje de escribir, como el buscador de
  // movimientos; los chips recargan al tiro. Cualquier cambio cancela la espera pendiente.
  function changeFilters(next: CandidateFilters, debounce = false) {
    const typing = debounce || next.q !== filters.q
    setFilters(next)
    clearTimeout(typingRef.current)
    if (typing) typingRef.current = setTimeout(() => loadCandidates(next), 300)
    else loadCandidates(next)
  }

  // En error, patch no cierra nada: la lista sigue abierta para elegir otro.
  function pickTransaction(transactionId: string) {
    patch(
      { paidWithTransactionId: transactionId },
      "Cobro vinculado al movimiento",
      "No se pudo vincular el movimiento"
    )
  }

  // Pausar es lo excepcional: vive acá y no en la fila, donde su botón le comía el ancho al
  // nombre en móvil. Terminada no se reanuda: hay que correr su fecha de fin.
  function toggleActive() {
    if (!template) return
    patch(
      { isActive: !template.isActive },
      template.isActive ? "Recurrente pausada" : "Recurrente reanudada",
      "No se pudo cambiar el estado"
    )
  }

  async function remove() {
    if (!template || saving) return
    setSaving(true)
    const res = await fetch(`/api/recurring/${template.id}`, {
      method: "DELETE",
    })
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return toast.error("No se pudo eliminar la recurrente")
    }
    haptic("success")
    toast.success("Recurrente eliminada")
    onOpenChange(false)
    router.refresh()
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={template ? "Editar recurrente" : "Nueva recurrente"}
    >
      {accounts.length === 0 ? (
        <div className="px-4 py-10 text-center text-subheadline text-muted-foreground">
          Necesitas una cuenta para crear un gasto recurrente.
        </div>
      ) : (
        <div className="flex flex-col px-5">
          {/* Estado del cobro del período: va arriba porque es el estado, no un campo. Elegir el
              movimiento a mano cubre el cargo que llegó con otra fecha y no se enganchó solo. */}
          {template && template.isActive && !template.hasEnded && (
            <div className="sheet-group mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 py-1 pr-1 pl-4">
              <span className="min-w-0 flex-1 basis-full py-2 text-subheadline sm:basis-0">
                {template.currentPeriodPaid
                  ? "El cobro de este período ya está registrado."
                  : "El cobro de este período todavía no llega."}
              </span>
              {(!template.currentPeriodPaid ||
                template.currentPeriodPaidManually) && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={openPicker}
                  disabled={saving}
                  className="h-11 shrink-0 text-subheadline text-primary"
                >
                  <ListChecks className="size-4" />
                  Elegir movimiento
                </Button>
              )}
            </div>
          )}

          <form
            id={formId}
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
          {/* 1 · Qué se cobra ------------------------------------------------ */}
          <Section title="Qué se cobra">
            <Input
              placeholder="Ej. Arriendo depto"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              aria-label="Nombre"
              className="h-11 rounded-lg text-body md:text-body"
            />
            <span className="block text-footnote text-muted-foreground">
              Es solo el nombre para reconocerla aquí; cambiarlo no afecta la
              detección del cargo en el correo.
            </span>
            {/* La categoría la manda el movimiento, no la plantilla: si se pudiera editar en los
                dos lados habría dos verdades. Como una recurrente solo nace de un movimiento,
                la categoría siempre es heredada; se cambia recategorizando el movimiento. */}
            <div className="flex items-center gap-2 rounded-xl bg-secondary/50 px-3 py-2.5">
              <CategoryIcon
                icon={inheritedCategory?.icon ?? null}
                size={18}
                color={inheritedCategory?.color ?? undefined}
              />
              <span className="min-w-0 flex-1 truncate text-subheadline font-medium">
                {inheritedCategory?.name ?? "Sin categoría"}
              </span>
              <span className="shrink-0 text-footnote text-muted-foreground">
                Del movimiento
              </span>
            </div>
          </Section>

          {/* 2 · Cuánto ------------------------------------------------------ */}
          <Section title="Cuánto">
            <div className="flex items-baseline gap-2">
              <span className="text-title-1 font-semibold text-muted-foreground">
                $
              </span>
              <Input
                inputMode="numeric"
                placeholder="0"
                value={money.display}
                onChange={(e) => money.onChange(e.target.value)}
                aria-label="Monto base"
                // md:text-large-title: el Input trae su tamaño de escritorio y dejaba el monto chico.
                className="tabular h-12 border-0 bg-transparent px-0 text-large-title font-bold shadow-none focus-visible:ring-0 md:text-large-title"
              />
            </div>

            {/* El rango ES el concepto de la recurrente: el cargo real varía mes a mes y aun así
                debe reconocerse. Por eso va en tamaño de dato, no en letra chica. */}
            <div className="rounded-xl bg-secondary/50 p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-footnote text-muted-foreground">
                  Reconoce cargos entre
                </span>
                <span className="tabular text-footnote font-medium text-muted-foreground">
                  ±{tolerancePct}%
                </span>
              </div>
              <div className="tabular flex items-baseline gap-2 text-headline">
                <span>{fmt(min)}</span>
                <span className="text-muted-foreground">—</span>
                <span>{fmt(max)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                step={5}
                value={tolerancePct}
                onChange={(e) => setTolerancePct(Number(e.target.value))}
                className="mt-3 w-full accent-primary"
                aria-label="Tolerancia del monto"
              />
            </div>
          </Section>

          {/* 3 · Cuándo ------------------------------------------------------ */}
          <Section title="Cuándo" last>
            <ChipRow>
              {PERIODICITIES.map((p) => (
                <Chip
                  key={p.value}
                  active={p.value === periodicity}
                  onClick={() => setPeriodicity(p.value)}
                >
                  {p.label}
                </Chip>
              ))}
            </ChipRow>
            {needsDay && (
              <div className="space-y-1.5">
                <DayOfMonthPicker value={day} onChange={setDay} />
                <span className="block text-footnote text-muted-foreground">
                  Si el mes no tiene ese día (ej. 31 en febrero), se usa el
                  último.
                </span>
              </div>
            )}
            <div className="space-y-1.5">
              <span className="block text-footnote font-medium text-muted-foreground">
                Hasta cuándo
              </span>
              {withEnd ? (
                <div className="flex items-center gap-2">
                  <span className="flex-1">
                    <DatePicker
                      value={endDate}
                      onChange={setEndDate}
                      placeholder="Elegir fecha de término"
                      fromDate={(
                        template?.startDate ?? new Date().toISOString()
                      ).slice(0, 10)}
                    />
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setWithEnd(false)
                      setEndDate("")
                    }}
                    className="h-11 shrink-0 rounded-lg text-subheadline text-muted-foreground"
                  >
                    Sin término
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  // El campo se abre VACÍO a propósito: una fecha propuesta (p. ej. "+1 año") se
                  // acepta sin mirar el año y termina guardando una vigencia que nadie eligió.
                  onClick={() => setWithEnd(true)}
                  className="min-h-11 text-left text-subheadline text-primary"
                >
                  No termina · poner fecha de término
                </button>
              )}
              {/* La fecha en palabras: el input muestra 25/08/2027 y el año se lee de reojo.
                  Escrito completo, un error de año salta a la vista antes de guardar. */}
              {endDate && (
                <span className="block text-footnote text-muted-foreground">
                  {readableEnd(endDate)
                    ? `Se cobra hasta el ${readableEnd(endDate)}; después queda finalizada.`
                    : "El último cobro es el de esa fecha; después queda finalizada."}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <span className="block text-footnote font-medium text-muted-foreground">
                Cuenta del cargo
              </span>
              <ChipRow>
                {accounts.map((a) => (
                  <Chip
                    key={a.id}
                    active={a.id === account?.id}
                    onClick={() => setAccountId(a.id)}
                  >
                    {a.name}
                  </Chip>
                ))}
              </ChipRow>
            </div>
          </Section>
          </form>

          {/* Lo excepcional, como filas de texto bajo el formulario y lejos de Guardar: pausar,
              deshacer la marca manual del período y eliminar (en rojo, con confirmación). */}
          {template && (
            <div className="sheet-group inset-list mb-2 overflow-hidden">
              {!template.hasEnded && (
                <button
                  type="button"
                  onClick={toggleActive}
                  disabled={saving}
                  className="press flex min-h-11 w-full items-center px-4 py-2.5 text-left text-body text-primary disabled:opacity-50"
                >
                  {template.isActive ? "Pausar recurrente" : "Reanudar recurrente"}
                </button>
              )}
              {template.isActive &&
                !template.hasEnded &&
                template.currentPeriodPaidManually && (
                  <button
                    type="button"
                    onClick={undoPaid}
                    disabled={saving}
                    className="press flex min-h-11 w-full items-center px-4 py-2.5 text-left text-body text-primary disabled:opacity-50"
                  >
                    Deshacer «Ya lo pagué»
                  </button>
                )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    disabled={saving}
                    className="press flex min-h-11 w-full items-center px-4 py-2.5 text-left text-body text-destructive disabled:opacity-50"
                  >
                    Eliminar recurrente
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      ¿Eliminar la recurrencia?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Se borra la plantilla y deja de cobrarse. Los movimientos
                      ya cobrados se conservan.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel type="button">
                      Cancelar
                    </AlertDialogCancel>
                    <AlertDialogAction
                      type="button"
                      onClick={remove}
                      variant="destructive"
                    >
                      Eliminar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {template && (
            <RecurringLinkPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              items={candidates}
              filters={filters}
              onFiltersChange={changeFilters}
              busy={saving}
              onPick={pickTransaction}
              onRetry={() => loadCandidates(filters)}
            />
          )}

          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="h-12 flex-1 text-body"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={!canSave}
              className="h-12 flex-1 text-body"
            >
              {saving
                ? "Guardando…"
                : template
                  ? "Guardar"
                  : "Crear recurrente"}
            </Button>
          </ModalFooter>
        </div>
      )}
    </ResponsiveModal>
  )
}

// Bloque temático del formulario. La separación por línea (no por tarjeta) evita el anidamiento
// de superficies dentro de un modal que ya es una tarjeta.
function Section({
  title,
  children,
  last,
}: {
  title: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 py-7",
        !last && "border-b border-border/60"
      )}
    >
      <h3 className="text-headline font-semibold">{title}</h3>
      {children}
    </section>
  )
}

// Fila de chips con scroll horizontal que sangra hasta los bordes del modal.
function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-5 flex scrollbar-none gap-2 overflow-x-auto px-5 pb-1">
      {children}
    </div>
  )
}
