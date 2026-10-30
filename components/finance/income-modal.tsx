"use client"

import type { ReactNode } from "react"

import { useId, useState } from "react"
import { useForm, Controller, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { CalendarIcon, Trash2 } from "lucide-react"
import { es } from "date-fns/locale"
import { toast } from "sonner"
import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { haptic } from "@/lib/haptics"
import { incomeSchema, type IncomeFormValues } from "@/lib/finance-form-schemas"
import {
  FinanceField,
  MoneyFormInput,
  financeResponseError,
} from "./finance-form-field"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import type {
  AccountDTO,
  CategoryDTO,
  IncomeDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

const acceptsIncome = (account: AccountDTO) =>
  account.accountType !== "credit_card" && account.accountType !== "credit_line"
export function IncomeModal({
  children,
  open,
  onOpenChange,
  accounts,
  categories,
  income,
  period,
  onCreateCategory,
}: {
  children?: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  income?: IncomeDTO | null
  period: { year: number; month: number }
  onCreateCategory: () => void
}) {
  const router = useRouter()
  const formId = `income-${useId()}`
  const destinations = accounts.filter(acceptsIncome)
  const incomeCategories = categories.filter(
    (category) => category.type === "income"
  )
  const [deleting, setDeleting] = useState(false)
  const form = useForm({
    resolver: zodResolver(incomeSchema),
    // Refresh after creating a category fills the untouched selector without erasing the draft.
    resetOptions: { keepDirtyValues: true },
    values: {
      name: income?.name ?? "",
      accountId: income?.accountId ?? destinations[0]?.id ?? "",
      categoryId: income?.categoryId ?? incomeCategories[0]?.id ?? "",
      amount: income?.amount ?? 0,
      dayOfMonth: income?.dayOfMonth ?? 1,
    },
  })
  const accountId = useWatch({ control: form.control, name: "accountId" })
  const currency = (destinations.find((account) => account.id === accountId)
    ?.currency ?? "CLP") as CurrencyCode
  const { errors, isSubmitting, isDirty, dirtyFields } = form.formState
  // RHF subscribes to dirtyFields to preserve those values during a reactive reset.
  const hasDraftChanges = isDirty || Object.keys(dirtyFields).length > 0
  const busy = isSubmitting || deleting
  async function save(values: IncomeFormValues) {
    form.clearErrors("root")
    try {
      const url = income
        ? `/api/incomes/${income.id}?year=${period.year}&month=${period.month}`
        : `/api/incomes?year=${period.year}&month=${period.month}`
      const res = await fetch(url, {
        method: income ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          name: values.name.trim(),
          ...(income ? { isActive: income.isActive } : {}),
        }),
      })
      if (!res.ok)
        throw new Error(
          await financeResponseError(
            res,
            "No se pudo guardar el ingreso. Vuelve a intentarlo."
          )
        )
      const data = await res.json().catch(() => ({}))
      haptic("success")
      toast.success(
        data.seed?.seeded
          ? `Presupuesto del mes: ${data.seed.total.toLocaleString("es-CL")}`
          : income
            ? "Ingreso actualizado"
            : "Ingreso agregado"
      )
      form.reset(undefined, { keepDirtyValues: false })
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      haptic("error")
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "No se pudo guardar el ingreso.",
      })
    }
  }
  async function remove() {
    if (!income || busy) return
    setDeleting(true)
    try {
      const res = await fetch(
        `/api/incomes/${income.id}?year=${period.year}&month=${period.month}`,
        { method: "DELETE" }
      )
      if (!res.ok)
        throw new Error(
          await financeResponseError(res, "No se pudo eliminar el ingreso.")
        )
      toast.success("Ingreso eliminado")
      form.reset(undefined, { keepDirtyValues: false })
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      form.setError("root", {
        message:
          error instanceof Error
            ? error.message
            : "No se pudo eliminar el ingreso.",
      })
    } finally {
      setDeleting(false)
    }
  }
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset(undefined, { keepDirtyValues: false })
        onOpenChange(next)
      }}
      title={income ? "Editar ingreso" : "Nuevo ingreso"}
    >
      {destinations.length === 0 ? (
        <>
          <p className="px-5 py-8 text-body leading-relaxed text-muted-foreground">
            Agrega una cuenta corriente, de ahorro o billetera para recibir
            ingresos. Las tarjetas de crédito registran pagos, no ingresos.
          </p>
          <ModalFooter className="px-5">
            <Button
              type="button"
              variant="outline"
              className="h-12 flex-1 text-body"
              onClick={() => onOpenChange(false)}
            >
              Cerrar
            </Button>
          </ModalFooter>
        </>
      ) : (
        <>
          <form
            id={formId}
            onSubmit={form.handleSubmit(save)}
            className="flex min-w-0 flex-col gap-7 px-5"
          >
            <fieldset disabled={busy} className="contents">
              {errors.root && (
                <p role="alert" className="text-subheadline text-destructive">
                  {errors.root.message}
                </p>
              )}
              <FinanceField
                id={`${formId}-name`}
                label="Nombre del ingreso"
                error={errors.name?.message}
              >
                <Input
                  id={`${formId}-name`}
                  {...form.register("name")}
                  required
                  inputMode="text"
                  className="h-12 text-body"
                  placeholder="Ej. Sueldo"
                  aria-invalid={!!errors.name}
                  aria-describedby={
                    errors.name ? `${formId}-name-error` : undefined
                  }
                />
              </FinanceField>
              <FinanceField
                id={`${formId}-account`}
                label="Cuenta donde entra"
                error={errors.accountId?.message}
              >
                <Controller
                  control={form.control}
                  name="accountId"
                  render={({ field }) => (
                    <Select
                      required
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger
                        id={`${formId}-account`}
                        className="h-12! w-full min-w-0 text-body"
                        aria-invalid={!!errors.accountId}
                        aria-describedby={
                          errors.accountId
                            ? `${formId}-account-error`
                            : undefined
                        }
                      >
                        <SelectValue
                          className="min-w-0 flex-1 text-left"
                          placeholder="Elige una cuenta"
                        />
                      </SelectTrigger>
                      <SelectContent
                        position="popper"
                        className="w-(--radix-select-trigger-width) max-w-[calc(100vw-2rem)]"
                      >
                        {destinations.map((account) => (
                          <SelectItem
                            key={account.id}
                            value={account.id}
                            className="[&>span:last-child]:min-w-0"
                          >
                            <span className="truncate">
                              {account.name} · {account.currency}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </FinanceField>
              <FinanceField
                id={`${formId}-amount`}
                label={`Monto (${currency})`}
                error={errors.amount?.message}
              >
                <Controller
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <MoneyFormInput
                      id={`${formId}-amount`}
                      name={field.name}
                      ref={field.ref}
                      value={field.value}
                      currency={currency}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                      placeholder="0"
                      aria-invalid={!!errors.amount}
                      aria-describedby={
                        errors.amount ? `${formId}-amount-error` : undefined
                      }
                    />
                  )}
                />
              </FinanceField>
              <FinanceField
                id={`${formId}-category`}
                label="Categoría de ingreso"
                error={errors.categoryId?.message}
              >
                <Controller
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => (
                    <Select
                      required
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger
                        id={`${formId}-category`}
                        className="h-12! w-full min-w-0 text-body"
                        aria-invalid={!!errors.categoryId}
                        aria-describedby={
                          errors.categoryId
                            ? `${formId}-category-error`
                            : undefined
                        }
                      >
                        <SelectValue
                          className="min-w-0 flex-1 text-left"
                          placeholder="Elige una categoría"
                        />
                      </SelectTrigger>
                      <SelectContent
                        position="popper"
                        className="w-(--radix-select-trigger-width) max-w-[calc(100vw-2rem)]"
                      >
                        {incomeCategories.map((category) => (
                          <SelectItem
                            key={category.id}
                            value={category.id}
                            className="[&>span:last-child]:min-w-0"
                          >
                            <span className="truncate">{category.name}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCreateCategory}
                  className="h-auto min-h-11 w-full min-w-0 py-2 whitespace-normal"
                >
                  Crear categoría de ingreso
                </Button>
              </FinanceField>
              <FinanceField
                id={`${formId}-day`}
                label="Día de ingreso"
                error={errors.dayOfMonth?.message}
                hint="Si ese día no existe en el mes, se usa el último día."
              >
                <Controller
                  control={form.control}
                  name="dayOfMonth"
                  render={({ field }) => (
                    <DayOfMonthPicker
                      id={`${formId}-day`}
                      value={field.value}
                      onChange={field.onChange}
                      aria-invalid={!!errors.dayOfMonth}
                      aria-describedby={`${formId}-day-${errors.dayOfMonth ? "error" : "hint"}`}
                    />
                  )}
                />
              </FinanceField>
            </fieldset>
          </form>
          <ModalFooter className="grid grid-cols-[minmax(0,1fr)_auto] px-5 sm:flex">
            <Button
              type="button"
              variant="outline"
              className="h-12"
              disabled={busy}
              onClick={() => {
                form.reset(undefined, { keepDirtyValues: false })
                onOpenChange(false)
              }}
            >
              Cancelar
            </Button>
            {income && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="size-12 text-destructive"
                    disabled={busy}
                    aria-label="Eliminar ingreso"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      ¿Eliminar esta fuente de ingreso?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Deja de contar desde este mes. Los meses anteriores
                      conservan su historia.
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
            )}
            <Button
              type="submit"
              form={formId}
              disabled={
                busy ||
                incomeCategories.length === 0 ||
                (!!income && !hasDraftChanges)
              }
              className="col-span-full h-auto min-h-12 min-w-0 py-3 text-body whitespace-normal sm:flex-1"
            >
              {isSubmitting
                ? "Guardando…"
                : income
                  ? "Guardar ingreso"
                  : "Agregar ingreso"}
            </Button>
          </ModalFooter>
        </>
      )}
      {children}
    </ResponsiveModal>
  )
}
// Mes de referencia con 31 días (enero) para que el calendario ofrezca todos los días 1–31.
// El ingreso es recurrente: guardamos solo el número de día, el mes/año no importan.
const DAY_PICKER_MONTH = new Date(2001, 0, 1)

// Exportado: lo reutiliza el modal de recurrentes (misma regla de día del mes).
export function DayOfMonthPicker({
  value,
  onChange,
  id,
  ...props
}: {
  value: number
  id?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
  onChange: (day: number) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          {...props}
          type="button"
          variant="outline"
          className="h-11 w-full justify-start rounded-lg text-body font-normal"
        >
          <CalendarIcon className="size-4 text-muted-foreground" />
          Día {value}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={es}
          month={DAY_PICKER_MONTH}
          disableNavigation
          showOutsideDays={false}
          selected={new Date(2001, 0, value)}
          onSelect={(d) => {
            if (!d) return
            onChange(d.getDate())
            setOpen(false)
          }}
          classNames={{ month_caption: "hidden", nav: "hidden" }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
