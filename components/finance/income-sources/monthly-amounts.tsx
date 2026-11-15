"use client"

import { useId, useMemo, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { ChevronRight, Plus } from "lucide-react"
import { toast } from "sonner"

import { ModalDangerRow, ModalSection, ResponsiveModal } from "@/components/ui/responsive-modal"
import { haptic } from "@/lib/haptics"
import { currentPeriod, formatMoney, monthName } from "@/lib/finance-format"
import { monthAmountSchema, yearMonthSchema } from "@/lib/schemas/income-source"
import { FinanceField, MoneyFormInput } from "../finance-form-field"
import { MonthPicker } from "../month-picker"
import { deleteMonthAmount, setMonthAmount, type IncomeSourceDTO } from "./http"

type MonthAmount = IncomeSourceDTO["amounts"][number]

const monthLabel = (key: string) =>
  `${monthName(Number(key.slice(5, 7)))} ${key.slice(0, 4)}`
const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`

// El mes va en la ruta y el monto en el body: el formulario junta los dos esquemas compartidos.
const formSchema = z.object({ month: yearMonthSchema, amount: monthAmountSchema.shape.amount })
type MonthAmountValues = z.infer<typeof formSchema>

/**
 * «Montos por mes» del editor de un programado: el sueldo no es igual todos los meses. Cada mes
 * ajustado reemplaza al monto base solo en ese mes; se guarda al confirmar, aparte del formulario
 * principal. La conciliación también fija el mes solo, al monto recibido.
 */
export function MonthlyAmounts({
  source,
  onChanged,
}: {
  source: IncomeSourceDTO
  onChanged: () => void
}) {
  // `source` es una foto tomada al abrir: los cambios se reflejan aquí sin esperar la recarga.
  const [amounts, setAmounts] = useState<MonthAmount[]>(source.amounts)
  const [editing, setEditing] = useState<MonthAmount | "new" | null>(null)
  const sorted = [...amounts].sort((a, b) => b.month.localeCompare(a.month))

  return (
    <div className="mt-8 px-5">
      <ModalSection
        title="Montos por mes"
        footer={`Si un mes llega otro monto, ajústalo aquí. Los demás meses usan ${formatMoney(source.amount, source.currency)}.`}
      >
        {sorted.map((a) => (
          <button
            key={a.month}
            type="button"
            onClick={() => setEditing(a)}
            className="press flex min-h-11 w-full min-w-0 items-center gap-3 py-2 pr-3 pl-4 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-body">{monthLabel(a.month)}</span>
            <span className="tabular shrink-0 text-subheadline text-muted-foreground">
              {formatMoney(a.amount, source.currency)}
            </span>
            <ChevronRight aria-hidden className="disclosure" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="press flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-primary"
        >
          <Plus aria-hidden className="size-5 shrink-0" />
          <span className="text-body">Ajustar un mes</span>
        </button>
      </ModalSection>
      <MonthAmountModal
        key={editing === null ? "closed" : editing === "new" ? "new" : editing.month}
        source={source}
        entry={editing}
        taken={amounts.map((a) => a.month)}
        onClose={() => setEditing(null)}
        onSaved={(next, removed) => {
          setAmounts((list) => [
            ...list.filter((a) => a.month !== next.month && a.month !== removed),
            ...(removed === next.month ? [] : [next]),
          ])
          setEditing(null)
          onChanged()
        }}
      />
    </div>
  )
}

function MonthAmountModal({
  source,
  entry,
  taken,
  onClose,
  onSaved,
}: {
  source: IncomeSourceDTO
  entry: MonthAmount | "new" | null
  taken: string[]
  onClose: () => void
  // `removed`: mes que dejó de estar ajustado (el mismo al quitarlo, el anterior si se cambió de mes).
  onSaved: (next: MonthAmount, removed?: string) => void
}) {
  const formId = `month-amount-${useId()}`
  const [removing, setRemoving] = useState(false)
  const existing = entry && entry !== "new" ? entry : null
  const now = currentPeriod()
  const schema = useMemo(
    () =>
      formSchema.refine((v) => v.month === existing?.month || !taken.includes(v.month), {
        path: ["month"],
        message: "Ese mes ya está ajustado: tócalo en la lista para cambiarlo",
      }),
    [existing?.month, taken]
  )
  const form = useForm<MonthAmountValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      month: existing?.month ?? monthKey(now.year, now.month),
      amount: existing?.amount ?? source.amount,
    },
  })
  const { errors, isSubmitting, isDirty } = form.formState
  const busy = isSubmitting || removing
  const fieldId = (name: string) => `${formId}-${name}`

  async function save(values: MonthAmountValues) {
    form.clearErrors("root")
    try {
      await setMonthAmount(source.id, values.month, values.amount)
      // Cambiar el mes de un ajuste existente: el mes anterior vuelve al monto base.
      if (existing && existing.month !== values.month)
        await deleteMonthAmount(source.id, existing.month)
      haptic("success")
      toast.success(`Monto de ${monthLabel(values.month)} guardado`)
      onSaved(values, existing && existing.month !== values.month ? existing.month : undefined)
    } catch (e) {
      haptic("error")
      form.setError("root", { message: e instanceof Error ? e.message : "No se pudo guardar el monto del mes." })
    }
  }

  async function remove() {
    if (!existing || busy) return
    setRemoving(true)
    try {
      await deleteMonthAmount(source.id, existing.month)
      haptic("success")
      toast.success(`${monthLabel(existing.month)} vuelve al monto base`)
      onSaved(existing, existing.month)
    } catch (e) {
      haptic("error")
      form.setError("root", { message: e instanceof Error ? e.message : "No se pudo quitar el monto del mes." })
    } finally {
      setRemoving(false)
    }
  }

  return (
    <ResponsiveModal
      open={entry !== null}
      onOpenChange={(o) => !o && !busy && onClose()}
      title={existing ? monthLabel(existing.month) : "Ajustar un mes"}
      cancel={{ label: "Cancelar", disabled: busy, onClick: onClose }}
      primary={{
        label: isSubmitting ? "Guardando…" : "Guardar",
        form: formId,
        busy: isSubmitting,
        disabled: busy || (!!existing && !isDirty),
      }}
    >
      <form id={formId} onSubmit={form.handleSubmit(save)} className="flex flex-col gap-7 px-5">
        <fieldset disabled={busy} className="contents">
          {errors.root && (
            <p role="alert" className="text-subheadline text-destructive">
              {errors.root.message}
            </p>
          )}
          <FinanceField id={fieldId("month")} label="Mes" required error={errors.month?.message}>
            <Controller
              control={form.control}
              name="month"
              render={({ field }) => (
                <div
                  id={fieldId("month")}
                  aria-invalid={!!errors.month}
                  aria-describedby={errors.month ? `${fieldId("month")}-error` : undefined}
                >
                  <MonthPicker
                    withYear
                    period={{
                      year: Number(field.value.slice(0, 4)),
                      month: Number(field.value.slice(5, 7)),
                    }}
                    onSelect={(y, m) => field.onChange(monthKey(y, m))}
                    className="h-12 w-full justify-start rounded-lg border px-3 text-body"
                  />
                </div>
              )}
            />
          </FinanceField>
          <FinanceField
            id={fieldId("amount")}
            label="Monto esperado ese mes"
            required
            error={errors.amount?.message}
          >
            <Controller
              control={form.control}
              name="amount"
              render={({ field }) => (
                <MoneyFormInput
                  id={fieldId("amount")}
                  name={field.name}
                  ref={field.ref}
                  currency={source.currency}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  required
                  aria-invalid={!!errors.amount}
                  aria-describedby={errors.amount ? `${fieldId("amount")}-error` : undefined}
                />
              )}
            />
          </FinanceField>
        </fieldset>
      </form>
      {existing && (
        <div className="mt-8 px-5">
          <ModalDangerRow disabled={busy} onClick={remove}>
            {removing ? "Quitando…" : "Volver al monto base"}
          </ModalDangerRow>
        </div>
      )}
    </ResponsiveModal>
  )
}
