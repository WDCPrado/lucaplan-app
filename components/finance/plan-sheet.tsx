"use client"

import type { ReactNode } from "react"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Pencil, Plus } from "lucide-react"
import { toast } from "sonner"

import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
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
import { daysUntilPayDay } from "@/lib/income-schedule"
import { planTotal, previousMonthLabel, shouldSuggest } from "@/lib/plan-total"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
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
  isCurrentMonth,
  globalLimit,
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
  period: { year: number; month: number }
  isCurrentMonth: boolean
  globalLimit: number | null
  allocated: number
  incomes: IncomeDTO[]
  previousCycleIncomes: IncomeDTO[]
  incomeCategories: CategoryDTO[]
  expenseCategories: CategoryDTO[]
  activeIncomeTotal: number
  // Lo que el mes anterior gastó por sobre su presupuesto global. Ya resuelto en el servidor.
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
  // Los ingresos cambiaron y ya no calzan con el presupuesto: se ofrece igualarlos, nunca se
  // hace solo (el presupuesto es una decisión, no un cálculo).
  const suggest = shouldSuggest(toAllocate, globalLimit)
  const previousMonth = previousMonthLabel(period.year, period.month)

  async function applySuggested() {
    if (applying) return
    setApplying(true)
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...period, globalLimit: toAllocate }),
      })
      if (!res.ok)
        throw new Error(
          await financeResponseError(
            res,
            "No se pudo actualizar el presupuesto."
          )
        )
      haptic("success")
      toast.success("Presupuesto actualizado")
      router.refresh()
    } catch (error) {
      haptic("error")
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el presupuesto."
      )
    } finally {
      setApplying(false)
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next) setDrafts({})
        onOpenChange(next)
      }}
      title={`Plan de ${monthName(period.month).toLowerCase()}`}
    >
      <div className="flex min-w-0 flex-col gap-8 px-5">
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
          <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              Ingresos pendientes del ciclo anterior
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Son para cubrir la factura anterior. Un ingreso generado en la app no significa que el banco lo haya abonado.
            </p>
            {previousCycleIncomes.filter((inc) => {
              const payDate = new Date(Date.UTC(
                period.month === 1 ? period.year - 1 : period.year,
                period.month === 1 ? 11 : period.month - 2,
                inc.dayOfMonth
              ))
              return !inc.generated || payDate.toISOString().slice(0, 10) > todayKey()
            }).map((inc) => (
              <div key={inc.id} className="border-b border-amber-500/20 last:border-0">
                <IncomeRow
                  income={inc}
                  period={{
                    year: period.month === 1 ? period.year - 1 : period.year,
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
              </div>
            ))}
          </section>
        )}
        {/* Presupuesto del mes */}
        <section>
          <h3 className="mb-3 text-base font-semibold">Presupuesto del mes</h3>
          {globalLimit === null ? (
            <button
              type="button"
              onClick={onEditBudget}
              className="flex w-full items-center justify-between gap-3 rounded-lg border-2 border-dashed border-border px-4 py-3 text-left text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  Definir presupuesto del mes
                </span>
                <span className="block text-xs">
                  Fija un límite global para repartir entre categorías
                </span>
              </span>
              <Plus className="size-5 shrink-0" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onEditBudget}
              aria-label="Editar presupuesto del mes"
              className="group w-full rounded-lg bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-accent"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="tabular text-2xl font-bold">
                  {formatCLP(globalLimit)}
                </span>
                <Pencil className="size-4 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Asignado <span className="tabular">{formatCLP(allocated)}</span>{" "}
                de <span className="tabular">{formatCLP(globalLimit)}</span>
              </div>
            </button>
          )}

          {/* De dónde sale el descuento. Va FUERA de la sugerencia a propósito: aplicarla apaga
              `suggest`, y si el porqué viviera ahí adentro desaparecería justo en el momento en
              que el presupuesto queda más chico —sin ningún rastro de por qué—. También es lo
              único que queda cuando la deuda se comió el ingreso y no hay botón que ofrecer. */}
          {previousMonthDebt > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              En {previousMonth} se gastó{" "}
              <span className="tabular font-semibold text-foreground">
                {formatMoney(previousMonthDebt, "CLP")}
              </span>{" "}
              por sobre el presupuesto.{" "}
              {toAllocate > 0 ? (
                <>
                  Esa plata ya salió, así que quedan{" "}
                  <span className="tabular font-semibold text-foreground">
                    {formatMoney(toAllocate, "CLP")}
                  </span>{" "}
                  para repartir este mes.
                </>
              ) : (
                <>
                  Esa plata ya salió y se lleva todo el ingreso de este mes, así
                  que no queda nada por repartir.
                </>
              )}
            </p>
          )}

          {suggest && (
            <div className="mt-3 flex flex-col gap-2 rounded-xl bg-muted/40 p-3">
              <p className="text-sm">
                Tus ingresos suman{" "}
                <span className="tabular font-semibold">
                  {formatMoney(activeIncomeTotal, "CLP")}
                </span>{" "}
                · presupuesto en {formatMoney(globalLimit ?? 0, "CLP")}
              </p>
              <Button
                type="button"
                onClick={applySuggested}
                disabled={applying}
                className="h-11 self-start"
              >
                {applying
                  ? "Actualizando…"
                  : previousMonthDebt > 0
                    ? `Ajustar a ${formatMoney(toAllocate, "CLP")}`
                    : "Igualar al ingreso"}
              </Button>
            </div>
          )}
        </section>

        {/* Ingresos: una fila por fuente, con su estado del mes */}
        <section>
          <h3 className="mb-3 text-base font-semibold">Ingresos</h3>
          <div className="divide-y divide-border/40">
            {incomes.map((inc) => (
              <IncomeRow
                key={inc.id}
                income={inc}
                period={period}
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
              className="flex w-full items-center gap-3 py-2.5 text-left text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-lg border-2 border-dashed border-border text-lg">
                +
              </span>
              {incomes.length > 0 ? (
                <span className="text-sm">Agregar ingreso</span>
              ) : (
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    Registra tus ingresos
                  </span>
                  <span className="block text-xs">
                    Sueldo, arriendo u otros · planifica cuánto entra
                  </span>
                </span>
              )}
            </button>
          </div>
        </section>

        {/* Categorías de ingreso: mismo patrón visual que las de gasto */}
        {incomeCategories.length > 0 && (
          <section>
            <h3 className="mb-3 text-base font-semibold">
              Categorías de ingreso
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {incomeCategories.map((c) => {
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => onOpenIncomeCategory(c)}
                    className="flex min-h-16 min-w-0 items-center gap-3 rounded-lg border p-3 text-left"
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted">
                      <CategoryIcon
                        icon={c.icon}
                        size={20}
                        color={c.color ?? undefined}
                      />
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium">
                        {c.name}
                      </span>
                      {/* Lo recibido en el mes: el "disponible" de una categoría de ingreso sin
                          meta era $0 justo debajo de un sueldo ya recibido. */}
                      <span className="tabular block text-xs break-words text-muted-foreground">
                        {formatCLP(c.used)}
                      </span>
                    </span>
                  </button>
                )
              })}
              <button
                type="button"
                onClick={onNewIncomeCategory}
                className="flex min-h-16 min-w-0 items-center gap-3 rounded-lg border p-3 text-left"
                aria-label="Nueva categoría de ingreso"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-border text-2xl text-muted-foreground">
                  +
                </span>
                <span className="text-xs text-muted-foreground">Nueva</span>
              </button>
            </div>
          </section>
        )}

        {/* Topes por categoría: el aviso «Te falta repartir…» abre este plan, así que acá se
            reparte. El saldo se recalcula al escribir; cada tope tiene un guardado explícito. */}
        {expenseCategories.length > 0 && (
          <section className="pb-2">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold">Topes por categoría</h3>
              {left !== null && (
                <span
                  className={cn(
                    "tabular text-sm",
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
            <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
              Puedes dejar dinero por repartir. Si superas el presupuesto, te
              avisamos sin bloquear.
            </p>
            <div className="divide-y divide-border/40">
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
          variant="outline"
          className="h-12 flex-1 text-base"
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
  period: { year: number; month: number }
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
      const response = await fetch("/api/category-limits", {
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
      className="space-y-3 py-4"
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
          className="min-w-0 flex-1 text-base font-medium"
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
          className="text-sm text-destructive"
        >
          {errors.limit.message}
        </p>
      )}
      {errors.root && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      {isDirty && (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11"
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
            className="h-11"
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
  isCurrentMonth,
  onEdit,
  onOpenCategory,
  priorCycle = false,
}: {
  income: IncomeDTO
  period: { year: number; month: number }
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
        `/api/incomes/${income.id}/generate?year=${period.year}&month=${period.month}`,
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
  const day = income.dayOfMonth
  let when: string
  if (income.generated) {
    when = priorCycle ? `Registrado en app · verificar abono del día ${day}` : `Llegó el ${day}`
  } else if (isCurrentMonth) {
    // Días reales hasta el pago: en modo tarjeta el mes en curso puede ser el siguiente.
    const diff = daysUntilPayDay(period, day, todayKey())
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
    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 py-4 sm:grid-cols-[2.75rem_minmax(0,1fr)_auto]">
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
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {income.name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {when}
          </span>
        </span>
      </button>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center justify-between gap-2 sm:col-start-auto sm:flex-col sm:items-end">
        <span className="tabular min-w-0 text-sm font-semibold break-words text-success">
          +{formatMoney(income.amount, income.currency as CurrencyCode)}
        </span>
        <button
          type="button"
          onClick={toggleGenerated}
          disabled={busy || (priorCycle && income.generated)}
          title={income.generated ? "Deshacer" : "Registrar el ingreso del mes"}
          className={cn(
            "flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium transition-colors disabled:opacity-50",
            income.generated
              ? "bg-success/10 text-success"
              : "bg-primary text-primary-foreground"
          )}
        >
          {income.generated && <Check className="size-3" />}
          {income.generated ? (priorCycle ? "Por verificar" : "Recibido") : "Generar"}
        </button>
      </div>
    </div>
  )
}
