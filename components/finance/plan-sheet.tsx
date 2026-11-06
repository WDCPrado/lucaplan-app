"use client"

import type { ReactNode } from "react"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronRight, Plus } from "lucide-react"
import { toast } from "sonner"

import {
  ModalFooter,
  ModalSection,
  ResponsiveModal,
} from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  categoryLimitSchema,
  type CategoryLimitFormValues,
} from "@/lib/finance-form-schemas"
import { MoneyFormInput, financeResponseError } from "./finance-form-field"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { CategoryIcon } from "./category-icons"
import {
  formatCLP,
  formatMoney,
  monthName,
  todayKey,
} from "@/lib/finance-format"
import { incomeDueDateInRange } from "@/lib/income-schedule"
import { planTotal, previousMonthLabel, shouldSuggest } from "@/lib/plan-total"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import type { PeriodMode } from "@/arch/shared/billing-cycle"
import { ClosingPicker, PeriodModeControl } from "./month-status"
import type {
  CategoryDTO,
  IncomeDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

/**
 * Plan del mes: de dónde viene la plata (ingresos) y cuánta se puede gastar (presupuesto).
 * Vive en una superficie propia porque son DECISIONES que se toman de vez en cuando, mientras que
 * el dashboard responde la pregunta diaria ("¿cuánto me queda?"). El resumen de arriba es el
 * resultado de lo que se configura acá.
 */
export function PlanSheet({
  children,
  open,
  onOpenChange,
  period,
  cycleRange,
  mode,
  closing,
  isCurrentMonth,
  globalLimit,
  globalLimitFollowsIncome,
  allocated,
  incomes,
  previousCycleIncomes,
  incomeCategories,
  expenseCategories,
  activeIncomeTotal,
  previousMonthDebt,
  onEditBudget,
  onAddIncome,
  onEditIncome,
  onOpenIncomeCategory,
  onNewIncomeCategory,
}: {
  children?: ReactNode
  open: boolean
  onOpenChange: (o: boolean) => void
  period: { year: number; month: number; mode: PeriodMode }
  cycleRange?: { start: string; end: string }
  mode: PeriodMode // modo guardado del período: mes calendario o ciclo de la tarjeta
  closing?: { date: string; estimated: boolean } // cierre del mes en pantalla; en modo calendario se muestra deshabilitado
  isCurrentMonth: boolean
  globalLimit: number | null
  globalLimitFollowsIncome: boolean // el tope lo puso «Igualar al ingreso» y sigue solo
  allocated: number
  incomes: IncomeDTO[]
  previousCycleIncomes: IncomeDTO[]
  incomeCategories: CategoryDTO[]
  expenseCategories: CategoryDTO[]
  activeIncomeTotal: number
  // Gastos realizados que superaron los ingresos del período anterior, resueltos en el servidor.
  previousMonthDebt: number
  onEditBudget: () => void
  onAddIncome: () => void
  onEditIncome: (income: IncomeDTO) => void
  onOpenIncomeCategory: (category: CategoryDTO) => void
  onNewIncomeCategory: () => void
}) {
  const router = useRouter()
  const [applying, setApplying] = useState(false)
  // Topes en edición (por id): lo que falta repartir se recalcula mientras se escribe, sin
  // esperar el refresh que trae cada guardado.
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  // Parent callbacks can close this surface without calling its onOpenChange.
  // Clearing on the closed render keeps the next session aligned with persisted rows.
  if (!open && Object.keys(drafts).length > 0) setDrafts({})
  const assigned = expenseCategories.reduce(
    (sum, c) => sum + (drafts[c.id] ?? c.limit),
    0
  )
  const left = globalLimit === null ? null : globalLimit - assigned
  // El total a repartir y la decisión de ofrecerlo viven en `lib/plan-total.ts`: son el mismo
  // número visto tres veces (lo que se muestra, lo que habilita el botón y lo que se POSTea), y
  // acá dentro no habría cómo fijarlos con tests.
  // (Con `globalLimit === null` la deuda es 0 por construcción: el límite global hereda por
  // carry-forward, así que un mes sin límite implica que tampoco lo hubo antes.)
  const toAllocate = planTotal(activeIncomeTotal, previousMonthDebt)
  // Los ingresos cambiaron y ya no calzan con el presupuesto: se ofrece igualarlos. Igualar deja
  // el tope siguiendo solo al total del plan (`followIncome`); uno escrito a mano no lo sigue.
  const suggest = shouldSuggest(toAllocate, globalLimit, globalLimitFollowsIncome)
  const previousPeriod = mode === "card_cycle" ? "el ciclo anterior" : previousMonthLabel(period.year, period.month)
  const periodNoun = mode === "card_cycle" ? "ciclo" : "mes"

  async function applySuggested() {
    if (applying) return
    setApplying(true)
    try {
      const res = await fetch(`/api/budgets?mode=${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...period, globalLimit: toAllocate, followIncome: true }),
      })
      if (!res.ok)
        throw new Error(
          await financeResponseError(
            res,
            "No se pudo actualizar el tope de gasto."
          )
        )
      haptic("success")
      toast.success("Tope de gasto actualizado")
      router.refresh()
    } catch (error) {
      haptic("error")
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el tope de gasto."
      )
    } finally {
      setApplying(false)
    }
  }

  // El rango del período va junto a «Período», no en el título: el título queda corto como en
  // los demás modales y el rango se lee donde se decide.
  const shortDay = (iso: string) =>
    `${iso.slice(8, 10)} ${monthName(Number(iso.slice(5, 7))).slice(0, 3).toLowerCase()}`
  const rangeLabel = cycleRange
    ? `${shortDay(cycleRange.start)} – ${shortDay(cycleRange.end)}`
    : monthName(period.month)
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next) setDrafts({})
        onOpenChange(next)
      }}
      title="Plan"
    >
      <div className="flex min-w-0 flex-col gap-8 px-5">
        {/* Período del plan: decide el rango de todo lo de abajo, por eso va primero. */}
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-3 px-4">
            <h3 className="text-headline font-semibold">Período</h3>
            <span className="tabular text-subheadline text-muted-foreground">
              {rangeLabel}
            </span>
          </div>
          <PeriodModeControl mode={mode} />
          {/* También en modo calendario, deshabilitado: así la hoja no salta al cambiar de modo. */}
          {closing && (
            <div className="mt-6">
              <ClosingPicker
                period={period}
                closing={closing}
                disabled={mode !== "card_cycle"}
              />
            </div>
          )}
        </section>
        {/* Exclusivo de modo crédito: el padre pasa [] en modo calendario. No confundir
            "generated" con depósito bancario; las fechas futuras prevalecen. */}
        {previousCycleIncomes.filter((inc) => {
          const payDate = new Date(Date.UTC(
            period.month === 1 ? period.year - 1 : period.year,
            period.month === 1 ? 11 : period.month - 2,
            inc.dayOfMonth
          ))
          const planned = payDate.toISOString().slice(0, 10)
          return !inc.generated || planned > todayKey()
        }).length > 0 && (
          <ModalSection
            title="Ingresos pendientes del ciclo anterior"
            className="px-4 [--inset:3.5rem]"
            footer="Son para cubrir la factura anterior. Un ingreso generado en la app no significa que el banco lo haya abonado."
          >
            {previousCycleIncomes.filter((inc) => {
              const payDate = new Date(Date.UTC(
                period.month === 1 ? period.year - 1 : period.year,
                period.month === 1 ? 11 : period.month - 2,
                inc.dayOfMonth
              ))
              return !inc.generated || payDate.toISOString().slice(0, 10) > todayKey()
            }).map((inc) => (
              <IncomeRow
                  key={inc.id}
                  income={inc}
                  period={{
                    mode,                    year: period.month === 1 ? period.year - 1 : period.year,
                    month: period.month === 1 ? 12 : period.month - 1,
                  }}
                  isCurrentMonth={false}
                  onEdit={() => onEditIncome(inc)}
                  onOpenCategory={() => {
                    const cat = incomeCategories.find((c) => c.id === inc.categoryId)
                    if (cat) onOpenIncomeCategory(cat)
                  }}
                  priorCycle
                />
            ))}
          </ModalSection>
        )}
        {/* Presupuesto del mes. De dónde sale el descuento va en el pie y FUERA de la
            sugerencia a propósito: aplicarla apaga `suggest`, y si el porqué viviera ahí adentro
            desaparecería justo cuando el presupuesto queda más chico —sin rastro de por qué—.
            También es lo único que queda cuando la deuda se comió el ingreso. */}
        <ModalSection
          title={`Tope de gasto del ${periodNoun}`}
          footer={
            previousMonthDebt > 0 && (
              <p>
                En {previousPeriod}, los gastos superaron los ingresos en{" "}
                <span className="tabular font-semibold text-foreground">
                  {formatMoney(previousMonthDebt, "CLP")}
                </span>.{" "}
                {toAllocate > 0 ? (
                  <>
                    Al cubrir esa diferencia, quedan{" "}
                    <span className="tabular font-semibold text-foreground">
                      {formatMoney(toAllocate, "CLP")}
                    </span>{" "}
                    para repartir este {periodNoun}.
                  </>
                ) : (
                  <>
                    Esa diferencia ocupa todo el ingreso de este {periodNoun},
                    así que no queda nada por repartir.
                  </>
                )}
              </p>
            )
          }
        >
          {globalLimit === null ? (
            <button
              type="button"
              onClick={onEditBudget}
              className="press flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left text-muted-foreground"
            >
              <span className="min-w-0">
                <span className="block text-body text-primary">
                  Definir presupuesto del {periodNoun}
                </span>
                <span className="block text-footnote">
                  Fija un límite global para repartir entre categorías
                </span>
              </span>
              <Plus className="size-5 shrink-0 text-primary" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onEditBudget}
              aria-label={`Editar presupuesto del ${periodNoun}`}
              className="press flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="tabular block text-title-1 font-bold break-words">
                  {formatCLP(globalLimit)}
                </span>
                <span className="mt-1 block text-footnote text-muted-foreground">
                  Asignado{" "}
                  <span className="tabular">{formatCLP(allocated)}</span> de{" "}
                  <span className="tabular">{formatCLP(globalLimit)}</span>
                </span>
              </span>
              <ChevronRight
                aria-hidden
                className="disclosure"
              />
            </button>
          )}
          {suggest && (
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 py-1 pr-1 pl-4">
              <p className="min-w-0 flex-1 basis-40 py-1.5 text-subheadline">
                Tus ingresos suman{" "}
                <span className="tabular font-semibold">
                  {formatMoney(activeIncomeTotal, "CLP")}
                </span>{" "}
                · presupuesto en {formatMoney(globalLimit ?? 0, "CLP")}
              </p>
              <Button
                type="button"
                variant="ghost"
                onClick={applySuggested}
                disabled={applying}
                className="press h-11 shrink-0 px-3 text-body font-semibold text-primary hover:bg-transparent hover:text-primary"
              >
                {applying
                  ? "Actualizando…"
                  : previousMonthDebt > 0
                    ? `Ajustar a ${formatMoney(toAllocate, "CLP")}`
                    : "Igualar al ingreso"}
              </Button>
            </div>
          )}
        </ModalSection>

        {/* Ingresos: una fila por fuente, con su estado del mes */}
        <ModalSection title="Ingresos" className="px-4 [--inset:3.5rem]">
            {incomes.map((inc) => (
              <IncomeRow
                key={inc.id}
                income={inc}
                period={period}
                cycleRange={cycleRange}
                isCurrentMonth={isCurrentMonth}
                onEdit={() => onEditIncome(inc)}
                onOpenCategory={() => {
                  const cat = incomeCategories.find(
                    (c) => c.id === inc.categoryId
                  )
                  if (cat) onOpenIncomeCategory(cat)
                }}
              />
            ))}
            <button
              type="button"
              onClick={onAddIncome}
              className="press flex w-full items-center gap-3 py-2.5 text-left text-primary"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-lg">
                <Plus className="size-5" aria-hidden="true" />
              </span>
              {incomes.length > 0 ? (
                <span className="text-body">Agregar ingreso</span>
              ) : (
                <span className="min-w-0">
                  <span className="block text-subheadline font-medium">
                    Registra tus ingresos
                  </span>
                  <span className="block text-footnote text-muted-foreground">
                    Sueldo, arriendo u otros · planifica cuánto entra
                  </span>
                </span>
              )}
            </button>
        </ModalSection>

        {/* Categorías de ingreso: mismo patrón visual que las de gasto */}
        {incomeCategories.length > 0 && (
          <ModalSection
            title="Categorías de ingreso"
            className="[--inset:4.25rem]"
          >
            {incomeCategories.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => onOpenIncomeCategory(c)}
                className="press flex min-h-11 w-full min-w-0 items-center gap-3 py-2 pr-3 pl-4 text-left"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted">
                  <CategoryIcon
                    icon={c.icon}
                    size={20}
                    color={c.color ?? undefined}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-body">
                  {c.name}
                </span>
                {/* Lo recibido en el mes: el "disponible" de una categoría de ingreso sin meta
                    era $0 justo debajo de un sueldo ya recibido. */}
                <span className="tabular shrink-0 text-subheadline text-muted-foreground">
                  {formatCLP(c.used)}
                </span>
                <ChevronRight
                  aria-hidden
                  className="disclosure"
                />
              </button>
            ))}
            <button
              type="button"
              onClick={onNewIncomeCategory}
              className="press flex min-h-11 w-full items-center gap-3 py-2 pr-3 pl-4 text-left text-primary"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-lg">
                <Plus className="size-5" aria-hidden="true" />
              </span>
              <span className="text-body">Nueva categoría de ingreso</span>
            </button>
          </ModalSection>
        )}

        {/* Topes por categoría: el aviso «Te falta repartir…» abre este plan, así que acá se
            reparte. El saldo se recalcula al escribir; cada tope tiene un guardado explícito. */}
        {expenseCategories.length > 0 && (
          <section className="pb-2">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3 px-4">
              <h3 className="text-headline font-semibold">Topes por categoría</h3>
              {left !== null && (
                <span
                  className={cn(
                    "tabular text-subheadline",
                    left < 0 ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {left === 0
                    ? "Todo repartido"
                    : left > 0
                      ? `Por repartir ${formatCLP(left)}`
                      : `Sobre-asignado ${formatCLP(-left)}`}
                </span>
              )}
            </div>
            <div className="sheet-group inset-list px-4 [--inset:3.5rem]">
              {expenseCategories.map((c) => (
                <LimitRow
                  // El tope guardado cambia con el refresh: la fila se rehace con el valor nuevo.
                  key={`${c.id}-${c.limit}`}
                  category={c}
                  period={period}
                  onDraft={(v) => setDrafts((d) => ({ ...d, [c.id]: v }))}
                />
              ))}
            </div>
          </section>
        )}
      </div>
      <ModalFooter className="px-5">
        <Button
          type="button"
          variant="secondary"
          className="h-12 flex-1 text-body"
          onClick={() => {
            setDrafts({})
            onOpenChange(false)
          }}
        >
          Cerrar plan
        </Button>
      </ModalFooter>
      {children}
    </ResponsiveModal>
  )
}

// Cada tope tiene un guardado explícito. Salir del campo nunca guarda por sorpresa.
function LimitRow({
  category,
  period,
  onDraft,
}: {
  category: CategoryDTO
  period: { year: number; month: number; mode: PeriodMode }
  onDraft: (value: number) => void
}) {
  const router = useRouter()
  const formId = `limit-${useId()}`
  const fieldId = `${formId}-amount`
  const form = useForm({
    resolver: zodResolver(categoryLimitSchema),
    values: { categoryId: category.id, ...period, limit: category.limit },
  })
  const { errors, isSubmitting, isDirty } = form.formState
  async function save(values: CategoryLimitFormValues) {
    form.clearErrors("root")
    try {
      const response = await fetch(`/api/category-limits?mode=${period.mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      if (!response.ok)
        throw new Error(
          await financeResponseError(
            response,
            `No se pudo guardar el tope de ${category.name}.`
          )
        )
      haptic("success")
      form.reset(values)
      router.refresh()
    } catch (error) {
      haptic("error")
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "No se pudo guardar el tope.",
      })
    }
  }
  return (
    <form
      id={formId}
      onSubmit={form.handleSubmit(save)}
      className="space-y-3 py-3"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted"
        >
          <CategoryIcon
            icon={category.icon}
            size={18}
            color={category.color ?? undefined}
          />
        </span>
        <label
          htmlFor={fieldId}
          className="min-w-0 flex-1 text-body font-medium"
        >
          {category.name}
        </label>
        <Controller
          name="limit"
          control={form.control}
          render={({ field }) => (
            <MoneyFormInput
              allowNegative
              id={fieldId}
              name={field.name}
              ref={field.ref}
              value={field.value}
              onValueChange={(value) => {
                field.onChange(value)
                onDraft(value)
              }}
              onBlur={field.onBlur}
              disabled={isSubmitting}
              aria-invalid={!!errors.limit}
              aria-describedby={errors.limit ? `${fieldId}-error` : undefined}
              placeholder="0"
              className="w-32 text-right"
            />
          )}
        />
      </div>
      {errors.limit && (
        <p
          id={`${fieldId}-error`}
          role="alert"
          className="text-subheadline text-destructive"
        >
          {errors.limit.message}
        </p>
      )}
      {errors.root && (
        <p role="alert" className="text-subheadline text-destructive">
          {errors.root.message}
        </p>
      )}
      {isDirty && (
        <div className="-my-2 flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            className="press h-11 px-3 text-body font-normal text-primary hover:bg-transparent hover:text-primary"
            disabled={isSubmitting}
            onClick={() => {
              form.reset()
              onDraft(category.limit)
            }}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="ghost"
            className="press h-11 px-3 text-body font-semibold text-primary hover:bg-transparent hover:text-primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Guardando…" : "Guardar tope"}
          </Button>
        </div>
      )}
    </form>
  )
}

// Fila de INGRESO (fuente): cuándo llega, cuánto y su estado del mes. El aro es la categoría
// (tocarla la edita); el resto de la fila edita el ingreso — son entidades separadas. "Generar"
// crea el movimiento (idempotente en el backend); tocar "Recibido" lo deshace.
// Exportada: el panel Presupuestos del dashboard muestra las mismas filas (misma acción, un tap menos).
function IncomeRow({
  income,
  period,
  cycleRange,
  isCurrentMonth,
  onEdit,
  onOpenCategory,
  priorCycle = false,
}: {
  income: IncomeDTO
  period: { year: number; month: number; mode: PeriodMode }
  cycleRange?: { start: string; end: string }
  isCurrentMonth: boolean
  onEdit: () => void
  onOpenCategory: () => void
  priorCycle?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function toggleGenerated() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(
        `/api/incomes/${income.id}/generate?year=${period.year}&month=${period.month}&mode=${period.mode}`,
        { method: income.generated ? "DELETE" : "POST" }
      )
      if (!res.ok)
        throw new Error(
          await financeResponseError(res, "No se pudo actualizar el ingreso.")
        )
      haptic("success")
      toast.success(income.generated ? "Ingreso deshecho" : "Ingreso recibido")
      router.refresh()
    } catch (error) {
      haptic("error")
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el ingreso."
      )
    } finally {
      setBusy(false)
    }
  }

  // Detalle de fecha: día absoluto siempre; en el mes actual, cuánto falta para que llegue.
  const scheduledDate = incomeDueDateInRange(period, income.dayOfMonth, cycleRange)
  const day = Number(scheduledDate.slice(-2))
  let when: string
  if (income.generated) {
    when = priorCycle ? `Registrado en Luca Plan · confirmar depósito del día ${day}` : `Llegó el ${day}`
  } else if (isCurrentMonth) {
    // Días reales hasta el pago: en modo tarjeta el mes en curso puede ser el siguiente.
    const diff = Math.round((Date.parse(`${scheduledDate}T00:00:00Z`) - Date.parse(`${todayKey()}T00:00:00Z`)) / 86400000)
    when =
      diff > 1
        ? `Llega el ${day} · en ${diff} días`
        : diff === 1
          ? `Llega el ${day} · mañana`
          : diff === 0
            ? "Llega hoy"
            : `Esperado el día ${day}`
  } else {
    when = `Llega el ${day} · ${income.accountName}`
  }

  return (
    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2">
      <button
        type="button"
        onClick={onOpenCategory}
        aria-label="Ver la categoría del ingreso"
        className="shrink-0"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted">
          <CategoryIcon
            icon={income.categoryIcon}
            size={18}
            color={income.categoryColor ?? undefined}
          />
        </span>
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="flex min-h-11 min-w-0 flex-col justify-center text-left"
      >
        <span className="block truncate text-body">{income.name}</span>
        <span className="block truncate text-footnote text-muted-foreground">
          {when}
        </span>
      </button>
      {/* Monto arriba y el estado como acción de texto debajo: «Generar» en azul, «Recibido» en
          verde (tocarlo lo deshace). Nada de pastillas rellenas dentro de la lista. */}
      <div className="flex min-w-0 flex-col items-end">
        <span className="tabular text-subheadline font-semibold text-success">
          +{formatMoney(income.amount, income.currency as CurrencyCode)}
        </span>
        <button
          type="button"
          onClick={toggleGenerated}
          disabled={busy || (priorCycle && income.generated)}
          title={income.generated ? "Deshacer" : "Registrar el ingreso del mes"}
          className={cn(
            "press -mr-2 -mb-2 flex min-h-11 items-center gap-1 px-2 text-subheadline font-semibold disabled:opacity-50",
            income.generated ? "text-success" : "text-primary"
          )}
        >
          {income.generated && <Check className="size-3.5" />}
          {income.generated ? (priorCycle ? "Verificar" : "Recibido") : "Generar"}
        </button>
      </div>
    </div>
  )
}
