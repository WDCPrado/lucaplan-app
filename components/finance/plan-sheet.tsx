"use client"

import type { ReactNode } from "react"

import { useEffect, useId, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronRight, Plus } from "lucide-react"
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
import { IconTile } from "./blocks"
import {
  formatCLP,
  formatMoney,
  monthName,
} from "@/lib/finance-format"
import { planTotal, previousMonthLabel, shouldSuggest } from "@/lib/plan-total"
import type { PeriodMode } from "@/arch/shared/billing-cycle"
import { ClosingPicker, PeriodModeControl } from "./month-status"
import type {
  CategoryDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import { IncomeSourceModal } from "./income-sources/income-source-modal"
import { listIncomeSources, type IncomeSourceDTO } from "./income-sources/http"

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
  globalLimit,
  globalLimitFollowsIncome,
  allocated,
  incomeCategories,
  expenseCategories,
  activeIncomeTotal,
  transactions,
  previousMonthDebt,
  onEditBudget,
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
  globalLimit: number | null
  globalLimitFollowsIncome: boolean // el tope sigue solo al ingreso del plan (no fijado a mano)
  allocated: number
  incomeCategories: CategoryDTO[]
  expenseCategories: CategoryDTO[]
  activeIncomeTotal: number
  // Movimientos del período: separan de cada categoría lo que ya cuenta bajo un programado.
  transactions: TransactionDTO[]
  // Gastos realizados que superaron los ingresos del período anterior, resueltos en el servidor.
  previousMonthDebt: number
  onEditBudget: () => void
  onOpenIncomeCategory: (category: CategoryDTO) => void
  onNewIncomeCategory: () => void
}) {
  const router = useRouter()
  const [applying, setApplying] = useState(false)
  const [editingSource, setEditingSource] = useState<IncomeSourceDTO | "new" | null>(null)
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
  // Un tope que sigue al ingreso se recalcula solo; uno fijado a mano ofrece volver a seguirlo
  // (`followIncome`), aunque ya calce con el total.
  const suggest = shouldSuggest(toAllocate, globalLimit, globalLimitFollowsIncome)
  const income = useIncomeSources(open, period, activeIncomeTotal)
  // Abonos que el plan ya cuenta bajo un programado: «Otros ingresos» muestra el resto de cada
  // categoría, así Programados + Otros = Total. `c.used` viene en CLP (USD convertido).
  const counted = new Set(income.sources.flatMap((s) => s.period.credits.map((c) => c.id)))
  const countedByCategory = new Map<string, number>()
  for (const t of transactions)
    if (counted.has(t.id) && t.categoryId)
      countedByCategory.set(
        t.categoryId,
        (countedByCategory.get(t.categoryId) ?? 0) + (t.amountClp ?? t.amount)
      )
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
      <div className="flex min-w-0 flex-col gap-6">
        {/* Período del plan: decide el rango de todo lo de abajo, por eso va primero. */}
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-3 px-4">
            <h3 className="text-callout font-semibold text-ink-2">Período</h3>
            <span className="text-callout whitespace-nowrap text-ink-2">
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
              className="press flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left text-ink-2"
            >
              <span className="min-w-0">
                <span className="block text-body text-primary">
                  Definir presupuesto del {periodNoun}
                </span>
                <span className="block text-caption text-ink-3">
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
                <span className="block text-title font-semibold whitespace-nowrap">
                  {formatCLP(globalLimit)}
                </span>
                <span className="mt-0.5 block text-caption text-ink-3">
                  Asignado{" "}
                  <span className="tabular">{formatCLP(allocated)}</span> de{" "}
                  <span className="tabular">{formatCLP(globalLimit)}</span>
                </span>
              </span>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-ink-3"
              />
            </button>
          )}
          {suggest && (
            <button
             
              type="button"
              onClick={applySuggested}
              disabled={applying}
              className="press min-h-11 px-4 text-left text-callout font-semibold text-primary disabled:opacity-45"
            >
              {applying ? "Actualizando…" : "Volver a seguir tus ingresos"}
            </button>
          )}
        </ModalSection>

        {/* Ingresos programados: la base del plan (el sueldo). Cuentan por lo esperado hasta que
            llega su abono; desde ahí, por lo recibido. */}
        <ModalSection
          title="Ingresos programados"
          className="[--inset:1rem]"
          footer={
            income.sources.length === 0 && !income.error
              ? "Lo que recibes todos los meses, como tu sueldo. Cuenta en el plan desde el día 1, aunque todavía no llegue."
              : undefined
          }
        >
          {income.error && (
            <div role="alert" className="flex min-h-11 flex-wrap items-center gap-x-3 pr-1 pl-4 text-callout text-destructive">
              <span className="min-w-0 flex-1 py-2">{income.error}</span>
              <button
                type="button"
                onClick={income.reload}
                className="press min-h-11 px-3 font-semibold text-primary"
              >
                Reintentar
              </button>
            </div>
          )}
          {income.sources.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => setEditingSource(s)}
              className="press flex min-h-11 w-full min-w-0 items-center gap-3 py-2 pr-3 pl-4 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="block truncate text-caption text-ink-3">
                  Día {s.dayOfMonth} · esperado{" "}
                  {formatMoney(s.period.expected || s.amount, s.currency)}
                  {s.endsOn && ` · hasta ${shortDay(s.endsOn.slice(0, 10))}`}
                </span>
              </span>
              <SourceStatus source={s} />
              <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setEditingSource("new")}
            className="press flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-primary"
          >
            <Plus className="size-5 shrink-0" aria-hidden="true" />
            <span className="text-body">Ingreso programado</span>
          </button>
        </ModalSection>

        {/* Otros ingresos: lo recibido por categoría que no cuenta bajo un programado. Tocar una
            abre su detalle con los abonos; ahí, en el abono, se dice si es reembolso o de qué
            programado es. */}
        <ModalSection
          title="Otros ingresos"
          className="[--inset:4rem]"
          footer={
            incomeCategories.length > 0
              ? "Toca una categoría para ver sus abonos. Desde el abono se marca si es reembolso o de qué ingreso programado es."
              : undefined
          }
        >
          {incomeCategories.map((c) => (
            <button
              type="button"
              key={c.id}
              onClick={() => onOpenIncomeCategory(c)}
              className="press flex min-h-11 w-full min-w-0 items-center gap-3 py-2 pr-3 pl-4 text-left"
            >
              <IconTile color={c.color ?? undefined}>
                <CategoryIcon icon={c.icon} size={18} />
              </IconTile>
              <span className="min-w-0 flex-1 truncate font-semibold">
                {c.name}
              </span>
              <span className="shrink-0 font-semibold whitespace-nowrap">
                {formatCLP(Math.max(0, c.used - (countedByCategory.get(c.id) ?? 0)))}
              </span>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-ink-3"
              />
            </button>
          ))}
          <button
            type="button"
            onClick={onNewIncomeCategory}
            className="press flex min-h-11 w-full items-center gap-3 py-2 pr-3 pl-4 text-left text-primary"
          >
            <span className="grid size-9 shrink-0 place-items-center">
              <Plus className="size-5" aria-hidden="true" />
            </span>
            <span className="text-body">Nueva categoría de ingreso</span>
          </button>
        </ModalSection>

        {/* El ingreso del plan: programados (esperado o recibido) más los otros ingresos, en CLP. */}
        <ModalSection
          footer={
            income.sources.some((s) => s.currency === "USD")
              ? "Los ingresos en dólares se planifican aparte y no suman a este total."
              : undefined
          }
        >
          <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3">
            <span className="text-body font-semibold">Ingreso del {periodNoun}</span>
            <span className="font-semibold whitespace-nowrap">
              {formatCLP(activeIncomeTotal)}
            </span>
          </div>
        </ModalSection>

        {/* Topes por categoría: el aviso «Te falta repartir…» abre este plan, así que acá se
            reparte. El saldo se recalcula al escribir; cada tope tiene un guardado explícito. */}
        {expenseCategories.length > 0 && (
          <section className="pb-2">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3 px-4">
              <h3 className="text-callout font-semibold text-ink-2">Topes por categoría</h3>
              {left !== null && (
                <span
                  className={cn(
                    "text-callout font-semibold whitespace-nowrap",
                    left < 0 ? "text-destructive" : left > 0 ? "text-warning" : "text-ink-2"
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
            <div className="tone-rows [&>*]:px-4">
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
      <ModalFooter>
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
      <IncomeSourceModal
        open={editingSource !== null}
        onOpenChange={(o) => !o && setEditingSource(null)}
        source={editingSource === "new" ? null : editingSource}
        incomeCategories={incomeCategories}
        onSaved={() => {
          income.reload()
          router.refresh()
        }}
      />
      {children}
    </ResponsiveModal>
  )
}

/** Estado del programado en el período: recibido (verde) o lo que falta por llegar. */
function SourceStatus({ source: s }: { source: IncomeSourceDTO }) {
  const { status, received, pending } = s.period
  if (status === "received")
    return (
      <span className="shrink-0 text-right text-callout whitespace-nowrap text-success">
        Recibido {formatMoney(received, s.currency)}
      </span>
    )
  if (status === "pending")
    return (
      <span className="shrink-0 text-right text-callout whitespace-nowrap text-ink-2">
        Pendiente {formatMoney(pending, s.currency)}
      </span>
    )
  return (
    <span className="shrink-0 text-right text-callout text-ink-2">
      Sin ingreso este período
    </span>
  )
}

/**
 * Programados del período del plan. Se leen de la API al abrir el plan (no hay render del servidor
 * dentro de la hoja) y otra vez cuando cambia el ingreso del plan: vincular un abono lo mueve.
 */
function useIncomeSources(
  open: boolean,
  period: { year: number; month: number },
  incomeTotal: number
) {
  const [sources, setSources] = useState<IncomeSourceDTO[]>([])
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const { year, month } = period
  // Efecto genuino: leer de la API mientras la hoja está abierta.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    listIncomeSources({ year, month }, controller.signal)
      .then((s) => {
        setError(null)
        setSources(s)
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "No se pudieron cargar los ingresos programados.")
      })
    return () => controller.abort()
  }, [open, year, month, incomeTotal, version])
  return { sources, error, reload: () => setVersion((v) => v + 1) }
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
        <IconTile color={category.color ?? undefined}>
          <CategoryIcon icon={category.icon} size={18} />
        </IconTile>
        <label
          htmlFor={fieldId}
          className="min-w-0 flex-1 truncate font-semibold"
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
          className="text-caption text-destructive"
        >
          {errors.limit.message}
        </p>
      )}
      {errors.root && (
        <p role="alert" className="text-callout text-destructive">
          {errors.root.message}
        </p>
      )}
      {isDirty && (
        <div className="-my-2 flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            className="h-(--ctl) px-3 text-callout font-semibold text-ink-2"
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
            className="h-(--ctl) px-3 text-callout font-semibold text-primary hover:bg-primary-soft hover:text-primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Guardando…" : "Guardar tope"}
          </Button>
        </div>
      )}
    </form>
  )
}
