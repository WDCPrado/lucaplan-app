"use client"

import { useId } from "react"
import { useForm, Controller, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { haptic } from "@/lib/haptics"
import { monthlyBudgetSchema } from "@/lib/finance-form-schemas"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { Switch } from "@/components/ui/switch"
import { useIsMobile } from "@/hooks/use-mobile"
import { formatCLP, monthName } from "@/lib/finance-format"
import { planTotal } from "@/lib/plan-total"
import {
  FinanceField,
  MoneyFormInput,
  financeResponseError,
} from "./finance-form-field"

const budgetFormSchema = monthlyBudgetSchema.extend({ followIncome: z.boolean() })

export function BudgetLimitModal({
  open,
  onOpenChange,
  period,
  current,
  followsIncome,
  income,
  previousMonthDebt,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  period: { year: number; month: number; mode: "calendar" | "card_cycle" }
  current: number | null
  followsIncome: boolean
  income: number
  previousMonthDebt: number
}) {
  const router = useRouter()
  const id = useId()
  const formId = `budget-${id}`
  const fieldId = `${formId}-limit`
  const isMobile = useIsMobile()
  const form = useForm({
    resolver: zodResolver(budgetFormSchema),
    values: { ...period, globalLimit: current ?? 0, followIncome: followsIncome },
  })
  const automatic = useWatch({ control: form.control, name: "followIncome" })
  const automaticLimit = planTotal(income, previousMonthDebt)
  const { errors, isSubmitting, isDirty } = form.formState
  async function save(values: {
    year: number
    month: number
    globalLimit: number
    followIncome: boolean
  }) {
    form.clearErrors("root")
    try {
      const res = await fetch(`/api/budgets?mode=${period.mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          globalLimit: values.followIncome ? automaticLimit : values.globalLimit,
        }),
      })
      if (!res.ok)
        throw new Error(
          await financeResponseError(
            res,
            "No se pudo guardar el tope de gasto. Vuelve a intentarlo."
          )
        )
      haptic("success")
      toast.success("Tope de gasto actualizado")
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      haptic("error")
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "No se pudo guardar el tope de gasto.",
      })
    }
  }
  return (
    <ResponsiveModal
      className="sm:max-w-md"
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset()
        onOpenChange(next)
      }}
      title={`Tope de gasto de ${monthName(period.month)}`}
      cancel={{
        label: "Cancelar",
        disabled: isSubmitting,
        onClick: () => {
          form.reset()
          onOpenChange(false)
        },
      }}
      primary={{
        label: isSubmitting ? "Guardando…" : "Guardar tope de gasto",
        form: formId,
        busy: isSubmitting,
        disabled: isSubmitting || (current !== null && !isDirty),
      }}
    >
      <form
        id={formId}
        onSubmit={form.handleSubmit(save)}
        className="flex flex-col gap-6"
      >
        <fieldset disabled={isSubmitting} className="contents">
          {errors.root && (
            <p role="alert" className="text-callout text-destructive">
              {errors.root.message}
            </p>
          )}
          <FinanceField
            id={`${formId}-automatic`}
            label="Ajustar automáticamente"
            hint="Actualiza el tope según tus ingresos y descuenta el déficit del período anterior. No modifica tus ingresos registrados."
          >
            <Controller
              name="followIncome"
              control={form.control}
              render={({ field }) => (
                <Switch
                  id={`${formId}-automatic`}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-describedby={`${formId}-automatic-hint`}
                />
              )}
            />
          </FinanceField>
          <dl className="rounded-lg bg-secondary px-4 py-1">
            {[
              ["Ingresos del período", formatCLP(income)],
              ["Déficit del período anterior", previousMonthDebt > 0 ? `−${formatCLP(previousMonthDebt)}` : formatCLP(0)],
              [automatic ? "Tope automático" : "Tope automático sugerido", formatCLP(automaticLimit)],
            ].map(([label, value]) => (
              <div key={label} className="flex min-h-11 items-center justify-between gap-4 py-2">
                <dt className="text-callout text-ink-2">{label}</dt>
                <dd className="font-semibold whitespace-nowrap">{value}</dd>
              </div>
            ))}
          </dl>
          <FinanceField
            id={fieldId}
            label="Tope de gasto total (CLP)"
            error={errors.globalLimit?.message}
            hint={automatic
              ? "El tope se calcula automáticamente. Desactiva el ajuste para ingresar un monto manual. Si el déficit ocupa todo el ingreso, el tope calculado es $0."
              : "Tope manual: no se actualiza con tus ingresos ni descuenta automáticamente el déficit anterior. Los períodos siguientes heredan este tope hasta que lo cambies."}
          >
            <Controller
              name="globalLimit"
              control={form.control}
              render={({ field }) => (
                <MoneyFormInput
                  id={fieldId}
                  name={field.name}
                  ref={field.ref}
                  value={automatic ? automaticLimit : field.value}
                  readOnly={automatic}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  autoFocus={!isMobile && !automatic}
                  aria-invalid={!!errors.globalLimit}
                  aria-describedby={`${fieldId}-${errors.globalLimit ? "error" : "hint"}`}
                  placeholder="500.000"
                />
              )}
            />
          </FinanceField>
        </fieldset>
      </form>
    </ResponsiveModal>
  )
}
