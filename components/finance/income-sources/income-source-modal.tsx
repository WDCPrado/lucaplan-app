"use client"

import { useId, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { z } from "zod"
import { toast } from "sonner"

import { ModalDangerRow, ResponsiveModal } from "@/components/ui/responsive-modal"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { haptic } from "@/lib/haptics"
import { todayKey } from "@/lib/finance-format"
import {
  createIncomeSourceSchema,
  type CreateIncomeSourceInput,
  type UpdateIncomeSourceInput,
} from "@/lib/schemas/income-source"
import type { CategoryDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import { FinanceField, MoneyFormInput } from "../finance-form-field"
import { DayOfMonthPicker } from "../day-of-month-picker"
import { DatePicker } from "../transaction-modal"
import { Segmented } from "../segmented"
import { MonthlyAmounts } from "./monthly-amounts"
import {
  createIncomeSource,
  deleteIncomeSource,
  updateIncomeSource,
  type IncomeSourceDTO,
} from "./http"

// El formulario valida con el mismo esquema que el POST; el PATCH manda solo lo que cambió.
const formSchema = createIncomeSourceSchema
type FormValues = z.input<typeof formSchema>

const CURRENCIES = [
  { value: "CLP" as const, label: "Pesos" },
  { value: "USD" as const, label: "Dólares" },
]

/** Crear o editar un ingreso programado (el sueldo): base del plan de cada mes. */
export function IncomeSourceModal({
  open,
  onOpenChange,
  source,
  incomeCategories,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  source: IncomeSourceDTO | null // null = crear
  incomeCategories: CategoryDTO[]
  onSaved: () => void
}) {
  const formId = `income-source-${useId()}`
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const form = useForm<FormValues, unknown, CreateIncomeSourceInput>({
    resolver: zodResolver(formSchema),
    values: {
      name: source?.name ?? "",
      categoryId: source?.categoryId ?? (incomeCategories.length === 1 ? incomeCategories[0].id : ""),
      currency: source?.currency ?? "CLP",
      amount: source?.amount ?? 0,
      dayOfMonth: source?.dayOfMonth ?? 1,
      startsOn: source?.startsOn.slice(0, 10) ?? todayKey(),
      endsOn: source?.endsOn ? source.endsOn.slice(0, 10) : null,
    },
  })
  const currency = useWatch({ control: form.control, name: "currency" })
  const startsOn = useWatch({ control: form.control, name: "startsOn" })
  const { errors, isSubmitting, isDirty, dirtyFields } = form.formState
  const busy = isSubmitting || deleting
  const describedBy = (name: keyof FormValues, hint = false) =>
    errors[name] ? `${formId}-${name}-error` : hint ? `${formId}-${name}-hint` : undefined

  function close() {
    form.reset()
    onOpenChange(false)
  }

  async function save(values: CreateIncomeSourceInput) {
    form.clearErrors("root")
    try {
      if (source) {
        // Solo lo que cambió.
        const changed = Object.fromEntries(
          (Object.keys(dirtyFields) as (keyof FormValues)[]).map((k) => [k, values[k]])
        ) as UpdateIncomeSourceInput
        await updateIncomeSource(source.id, changed)
      } else {
        await createIncomeSource(values)
      }
      haptic("success")
      toast.success(source ? "Ingreso programado guardado" : "Ingreso programado creado")
      close()
      onSaved()
    } catch (e) {
      haptic("error")
      form.setError("root", {
        message: e instanceof Error ? e.message : "No se pudo guardar el ingreso programado.",
      })
    }
  }

  async function remove() {
    if (!source || busy) return
    setDeleting(true)
    try {
      const res = await deleteIncomeSource(source.id)
      haptic("success")
      toast.success(
        res.ended
          ? "Ingreso programado terminado hoy; sus abonos siguen vinculados"
          : "Ingreso programado eliminado"
      )
      close()
      onSaved()
    } catch (e) {
      haptic("error")
      form.setError("root", {
        message: e instanceof Error ? e.message : "No se pudo eliminar el ingreso programado.",
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={source ? "Ingreso programado" : "Nuevo ingreso programado"}
      cancel={{ label: "Cancelar", disabled: busy, onClick: close }}
      primary={{
        label: isSubmitting ? "Guardando…" : "Guardar",
        form: formId,
        busy: isSubmitting,
        disabled: busy || (!!source && !isDirty),
      }}
    >
      <form
        id={formId}
        onSubmit={form.handleSubmit(save)}
        className="flex flex-col gap-7 px-5"
      >
        <fieldset disabled={busy} className="contents">
          {errors.root && (
            <p role="alert" className="text-subheadline text-destructive">
              {errors.root.message}
            </p>
          )}
          <FinanceField id={`${formId}-name`} label="Nombre" required error={errors.name?.message}>
            <Input
              {...form.register("name")}
              id={`${formId}-name`}
              required
              maxLength={80}
              inputMode="text"
              autoComplete="off"
              className="h-12 text-body"
              placeholder="Ej. Sueldo"
              aria-invalid={!!errors.name}
              aria-describedby={describedBy("name")}
            />
          </FinanceField>
          <FinanceField
            id={`${formId}-categoryId`}
            label="Categoría de ingreso"
            required
            error={errors.categoryId?.message}
            hint={
              incomeCategories.length === 0
                ? "Primero crea una categoría de ingreso en el plan."
                : undefined
            }
          >
            <Controller
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} required>
                  <SelectTrigger
                    id={`${formId}-categoryId`}
                    className="h-12! w-full text-body"
                    aria-invalid={!!errors.categoryId}
                    aria-describedby={describedBy("categoryId", incomeCategories.length === 0)}
                  >
                    <SelectValue placeholder="Elegir categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {incomeCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FinanceField>
          <div className="grid gap-7 sm:grid-cols-2">
            <FinanceField id={`${formId}-currency`} label="Moneda" required>
              <Controller
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <Segmented
                    label="Moneda"
                    value={field.value}
                    options={CURRENCIES}
                    disabled={busy}
                    onChange={(next) => {
                      field.onChange(next)
                      // Pesos y dólares no se convierten: el monto se vuelve a escribir.
                      form.setValue("amount", 0, { shouldDirty: true })
                    }}
                  />
                )}
              />
            </FinanceField>
            <FinanceField
              id={`${formId}-amount`}
              label={source ? "Monto base" : "Monto esperado"}
              required
              error={errors.amount?.message}
              hint="Lo que esperas cada mes; cuenta en el plan hasta que llegue el abono."
            >
              <Controller
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <MoneyFormInput
                    id={`${formId}-amount`}
                    name={field.name}
                    ref={field.ref}
                    currency={currency}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    required
                    placeholder={currency === "USD" ? "1.000,00" : "1.500.000"}
                    aria-invalid={!!errors.amount}
                    aria-describedby={describedBy("amount", true)}
                  />
                )}
              />
            </FinanceField>
          </div>
          <FinanceField
            id={`${formId}-dayOfMonth`}
            label="Día del mes en que llega"
            required
            error={errors.dayOfMonth?.message}
            hint="Si el mes es más corto, se espera el último día."
          >
            <Controller
              control={form.control}
              name="dayOfMonth"
              render={({ field }) => (
                <DayOfMonthPicker
                  id={`${formId}-dayOfMonth`}
                  value={field.value}
                  onChange={field.onChange}
                  aria-invalid={!!errors.dayOfMonth}
                  aria-describedby={describedBy("dayOfMonth", true)}
                />
              )}
            />
          </FinanceField>
          <div className="grid gap-7 sm:grid-cols-2">
            <FinanceField id={`${formId}-startsOn`} label="Desde" required error={errors.startsOn?.message}>
              <Controller
                control={form.control}
                name="startsOn"
                render={({ field }) => (
                  <DatePicker
                    id={`${formId}-startsOn`}
                    value={field.value}
                    onChange={field.onChange}
                    invalid={!!errors.startsOn}
                    describedBy={describedBy("startsOn")}
                  />
                )}
              />
            </FinanceField>
            <FinanceField
              id={`${formId}-endsOn`}
              label="Hasta (opcional)"
              error={errors.endsOn?.message}
              hint="Vacío: sigue todos los meses."
            >
              <Controller
                control={form.control}
                name="endsOn"
                render={({ field }) => (
                  <DatePicker
                    id={`${formId}-endsOn`}
                    value={field.value ?? ""}
                    onChange={(v) => field.onChange(v || null)}
                    fromDate={startsOn}
                    placeholder="Sin término"
                    invalid={!!errors.endsOn}
                    describedBy={describedBy("endsOn", true)}
                  />
                )}
              />
            </FinanceField>
          </div>
        </fieldset>
      </form>
      {source && <MonthlyAmounts key={source.id} source={source} onChanged={onSaved} />}
      {source && (
        <div className="mt-8 px-5">
          <ModalDangerRow disabled={busy} onClick={() => setConfirmDelete(true)}>
            {deleting ? "Eliminando…" : "Eliminar ingreso programado"}
          </ModalDangerRow>
        </div>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{source?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Deja de contar en el plan. Si ya tiene abonos vinculados, no se borra: termina hoy y
              los abonos quedan como están.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={remove} variant="destructive">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ResponsiveModal>
  )
}
