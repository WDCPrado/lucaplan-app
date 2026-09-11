"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Pencil, Plus } from "lucide-react"
import { toast } from "sonner"

import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useMoneyInput } from "@/hooks/use-money-input"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { CategoryIcon } from "./category-icons"
import { ProgressRing } from "./progress-ring"
import {
  currentPeriod,
  formatCLP,
  formatMoney,
  monthName,
} from "@/lib/finance-format"
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
  open,
  onOpenChange,
  period,
  isCurrentMonth,
  globalLimit,
  allocated,
  incomes,
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
  open: boolean
  onOpenChange: (o: boolean) => void
  period: { year: number; month: number }
  isCurrentMonth: boolean
  globalLimit: number | null
  allocated: number
  incomes: IncomeDTO[]
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
    setApplying(true)
    const res = await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: period.year,
        month: period.month,
        globalLimit: toAllocate,
      }),
    })
    setApplying(false)
    if (!res.ok) {
      haptic("error")
      return toast.error("No se pudo actualizar el presupuesto")
    }
    haptic("success")
    toast.success("Presupuesto actualizado")
    router.refresh()
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Plan de ${monthName(period.month).toLowerCase()}`}
    >
      <div className="flex flex-col gap-6 px-4">
        {/* Presupuesto del mes */}
        <section>
          <h3 className="mb-2 text-sm font-medium">Presupuesto del mes</h3>
          {globalLimit === null ? (
            <button
              onClick={onEditBudget}
              className="flex w-full items-center justify-between gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3 text-left text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
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
              onClick={onEditBudget}
              aria-label="Editar presupuesto del mes"
              className="group w-full rounded-xl bg-secondary/50 px-4 py-3 text-left transition-colors hover:bg-accent"
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
            <div className="mt-3 flex flex-col gap-2 rounded-xl bg-secondary/50 p-3">
              <p className="text-sm">
                Tus ingresos suman{" "}
                <span className="tabular font-semibold">
                  {formatMoney(activeIncomeTotal, "CLP")}
                </span>{" "}
                · presupuesto en {formatMoney(globalLimit ?? 0, "CLP")}
              </p>
              <Button
                onClick={applySuggested}
                disabled={applying}
                className="h-10 self-start rounded-full"
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
          <h3 className="mb-1 text-sm font-medium">Ingresos</h3>
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
              onClick={onAddIncome}
              className="flex w-full items-center gap-3 py-2.5 text-left text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-dashed border-border text-lg">
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
                    Sueldo, arriendo u otros · definen tu presupuesto
                  </span>
                </span>
              )}
            </button>
          </div>
        </section>

        {/* Categorías de ingreso: mismo patrón visual que las de gasto */}
        {incomeCategories.length > 0 && (
          <section>
            <h3 className="mb-3 text-sm font-medium">Categorías de ingreso</h3>
            <div className="flex flex-wrap gap-4">
              {incomeCategories.map((c) => {
                // Avance hacia la meta; sin meta definida, lleno si ya entró algo.
                const pct =
                  c.limit > 0 ? (c.used / c.limit) * 100 : c.used > 0 ? 100 : 0
                return (
                  <button
                    key={c.id}
                    onClick={() => onOpenIncomeCategory(c)}
                    className="flex w-20 shrink-0 flex-col items-center gap-1.5"
                  >
                    <ProgressRing percent={pct} status={c.status} size={72}>
                      <CategoryIcon
                        icon={c.icon}
                        size={22}
                        color={c.color ?? undefined}
                      />
                    </ProgressRing>
                    <span className="w-full text-center">
                      <span className="block truncate text-xs font-medium">
                        {c.name}
                      </span>
                      {/* Lo recibido en el mes: el "disponible" de una categoría de ingreso sin
                          meta era $0 justo debajo de un sueldo ya recibido. */}
                      <span className="tabular block text-xs text-muted-foreground">
                        {formatCLP(c.used)}
                      </span>
                    </span>
                  </button>
                )
              })}
              <button
                onClick={onNewIncomeCategory}
                className="flex w-20 shrink-0 flex-col items-center gap-1.5"
                aria-label="Nueva categoría de ingreso"
              >
                <span className="grid size-18 place-items-center rounded-full border-2 border-dashed border-border text-2xl text-muted-foreground">
                  +
                </span>
                <span className="text-xs text-muted-foreground">Nueva</span>
              </button>
            </div>
          </section>
        )}

        {/* Topes por categoría: el aviso «Te falta repartir…» abre este plan, así que acá se
            reparte. Un tope se guarda al salir del campo; el saldo se recalcula al escribir. */}
        {expenseCategories.length > 0 && (
          <section className="pb-2">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-medium">Topes por categoría</h3>
              {left !== null && (
                <span
                  className={cn(
                    "tabular text-xs",
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
    </ResponsiveModal>
  )
}

// Fila de tope de una categoría de gasto: el monto se edita en línea y se guarda al salir del
// campo (POST /api/category-limits, un mes concreto). Vacío es «sin tope» (0).
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
  const money = useMoneyInput("CLP", category.limit)
  const [saving, setSaving] = useState(false)

  async function commit() {
    if (money.value === category.limit || saving) return
    setSaving(true)
    const res = await fetch("/api/category-limits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId: category.id,
        year: period.year,
        month: period.month,
        limit: money.value,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      toast.error(`No se pudo guardar el tope de ${category.name}`)
      money.reset(category.limit)
      onDraft(category.limit)
      return
    }
    haptic("success")
    router.refresh()
  }

  return (
    <label className="flex items-center gap-3 py-2">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full"
        style={{
          background: category.color ? `${category.color}1f` : "var(--muted)",
        }}
        aria-hidden
      >
        <CategoryIcon
          icon={category.icon}
          size={16}
          color={category.color ?? undefined}
        />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {category.name}
      </span>
      <span className="flex items-baseline gap-1">
        <span className="text-sm text-muted-foreground" aria-hidden>
          $
        </span>
        <Input
          inputMode="numeric"
          placeholder="Sin tope"
          aria-label={`Tope de ${category.name}`}
          value={money.display}
          disabled={saving}
          onChange={(e) => onDraft(money.onChange(e.target.value))}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="tabular h-9 w-28 text-right text-base md:text-base"
        />
      </span>
    </label>
  )
}

// Fila de INGRESO (fuente): cuándo llega, cuánto y su estado del mes. El aro es la categoría
// (tocarla la edita); el resto de la fila edita el ingreso — son entidades separadas. "Generar"
// crea el movimiento (idempotente en el backend); tocar "Recibido" lo deshace.
// Exportada: el panel Presupuestos del dashboard muestra las mismas filas (misma acción, un tap menos).
export function IncomeRow({
  income,
  period,
  isCurrentMonth,
  onEdit,
  onOpenCategory,
}: {
  income: IncomeDTO
  period: { year: number; month: number }
  isCurrentMonth: boolean
  onEdit: () => void
  onOpenCategory: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function toggleGenerated() {
    if (busy) return
    setBusy(true)
    haptic("light")
    const res = await fetch(
      `/api/incomes/${income.id}/generate?year=${period.year}&month=${period.month}`,
      { method: income.generated ? "DELETE" : "POST" }
    )
    setBusy(false)
    if (!res.ok) {
      haptic("error")
      toast.error("No se pudo actualizar el ingreso")
      return
    }
    haptic("success")
    toast.success(income.generated ? "Ingreso deshecho" : "Ingreso recibido")
    router.refresh()
  }

  // Detalle de fecha: día absoluto siempre; en el mes actual, cuánto falta para que llegue.
  const day = income.dayOfMonth
  let when: string
  if (income.generated) {
    when = `Llegó el ${day}`
  } else if (isCurrentMonth) {
    const diff = day - currentPeriod().day
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
    <div className="flex items-center gap-3 py-2.5">
      <button
        onClick={onOpenCategory}
        aria-label="Ver la categoría del ingreso"
        className="shrink-0"
      >
        <ProgressRing
          percent={income.generated ? 100 : 0}
          status="bueno"
          size={44}
        >
          <CategoryIcon
            icon={income.categoryIcon}
            size={16}
            color={income.categoryColor ?? undefined}
          />
        </ProgressRing>
      </button>
      <button
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {income.name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {when}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="tabular text-sm font-semibold text-success">
          +{formatMoney(income.amount, income.currency as CurrencyCode)}
        </span>
        <button
          onClick={toggleGenerated}
          disabled={busy}
          title={income.generated ? "Deshacer" : "Registrar el ingreso del mes"}
          className={cn(
            "flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition duration-150 ease-out active:scale-[0.97] disabled:opacity-50",
            income.generated
              ? "bg-success/10 text-success"
              : "bg-primary text-primary-foreground"
          )}
        >
          {income.generated && <Check className="size-3" />}
          {income.generated ? "Recibido" : "Generar"}
        </button>
      </div>
    </div>
  )
}
