"use client"

import { useId } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { haptic } from "@/lib/haptics"
import { monthlyBudgetSchema } from "@/lib/finance-form-schemas"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { useIsMobile } from "@/hooks/use-mobile"
import { monthName } from "@/lib/finance-format"
import {
  FinanceField,
  MoneyFormInput,
  financeResponseError,
} from "./finance-form-field"

export function BudgetLimitModal({
  open,
  onOpenChange,
  period,
  current,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  period: { year: number; month: number; mode: "calendar" | "card_cycle" }
  current: number | null
}) {
  const router = useRouter()
  const id = useId()
  const formId = `budget-${id}`
  const fieldId = `${formId}-limit`
  const isMobile = useIsMobile()
  const form = useForm({
    resolver: zodResolver(monthlyBudgetSchema),
    values: { ...period, globalLimit: current ?? 0 },
  })
  const { errors, isSubmitting, isDirty } = form.formState
  async function save(values: {
    year: number
    month: number
    globalLimit: number
  }) {
    form.clearErrors("root")
    try {
      const res = await fetch(`/api/budgets?mode=${period.mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
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
        disabled: isSubmitting || (current !== null && !isDirty),
      }}
    >
      <form
        id={formId}
        onSubmit={form.handleSubmit(save)}
        className="flex flex-col gap-7 px-5"
      >
        <fieldset disabled={isSubmitting} className="contents">
          {errors.root && (
            <p role="alert" className="text-subheadline text-destructive">
              {errors.root.message}
            </p>
          )}
          <FinanceField
            id={fieldId}
            label="Tope de gasto total (CLP)"
            error={errors.globalLimit?.message}
            hint="Define cuánto quieres gastar. Puedes dejar dinero por repartir; los meses siguientes heredan este tope hasta que lo cambies."
          >
            <Controller
              name="globalLimit"
              control={form.control}
              render={({ field }) => (
                <MoneyFormInput
                  id={fieldId}
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  autoFocus={!isMobile}
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
