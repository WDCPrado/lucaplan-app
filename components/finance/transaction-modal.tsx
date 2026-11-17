"use client"

import * as React from "react"
import { useId, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  transactionEditFormSchema,
  type TransactionUpdateFormValues,
} from "@/lib/finance-form-schemas"
import {
  FinanceField,
  MoneyFormInput,
  financeResponseError,
} from "./finance-form-field"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { es } from "date-fns/locale"
import {
  CalendarIcon,
  ChevronRight,
  CircleDashed,
  CreditCard,
  PauseCircle,
  PlayCircle,
  Repeat,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import {
  ModalActions,
  ModalDangerRow,
  ModalDataRow,
  ModalSection,
  ResponsiveModal,
  ResponsivePopover,
  modalActionRow,
} from "@/components/ui/responsive-modal"
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
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { CorrectionLearnStep } from "./correction-learn-step"
import { RecurringModal } from "./recurring-modal"
import { InstallmentModal } from "./installment-modal"
import { AssignToInstallmentModal } from "./assign-to-installment-modal"
import { CategoryIcon } from "./category-icons"
import { Segmented } from "./segmented"
import { ProgressBar } from "./blocks"
import { ReimbursementSection } from "./reimbursements/reimbursement-section"
import { IncomeSourceLink } from "./income-sources/income-source-link"
import {
  categoryUsageLine,
  formatCLP,
  formatMoney,
} from "@/lib/finance-format"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import type { Direction } from "@/arch/v1/domain/finance/finance.domain"
import type {
  AccountDTO,
  TransactionDTO,
  CategoryDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

// Descripción de la cuenta de un movimiento: "Banco · •••• 1234" (o el nombre si no hay tarjeta).
function accountLabel(account: AccountDTO | undefined): string | null {
  if (!account) return null
  const bank = account.bankName || account.name
  const card = account.cardLast4 ? `•••• ${account.cardLast4}` : account.name
  return account.cardLast4 ? `${bank} · ${card}` : bank
}

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmado",
  pending: "Pendiente",
  // `committed` no es un estado del banco: es cómo se muestra un `pending` que creó una plantilla.
  committed: "Por cobrar",
  reversed: "Reversado",
  duplicated: "Duplicado",
}

// Borrar revierte el efecto del movimiento en el saldo: un ingreso lo baja, un gasto lo sube.
// La confirmación lo dice con esas palabras — "se ajusta el saldo" no explica hacia dónde.
const deleteCopy = (income: boolean) => ({
  title: income ? "¿Eliminar este ingreso?" : "¿Eliminar este gasto?",
  description: income
    ? "Se borra el movimiento y su monto se descuenta del saldo de la cuenta."
    : "Se borra el movimiento y su monto vuelve a la cuenta: el saldo se recalcula hacia arriba.",
})

const fullDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

// La categoría GUARDADA del movimiento va primero en los chips (si pasa el filtro por tipo).
// Se ancla a tx.categoryId, no a la selección en pantalla: el orden no salta al tocar chips.
// Exportado: el triage reutiliza el mismo orden.
export function savedFirst(
  list: CategoryDTO[],
  savedId: string | null
): CategoryDTO[] {
  const saved = savedId ? list.find((c) => c.id === savedId) : undefined
  return saved ? [saved, ...list.filter((c) => c.id !== saved.id)] : list
}

// Uso del presupuesto del mes de la categoría SELECCIONADA en los chips: justo al categorizar es
// cuando sirve saber cómo viene la categoría. El dato llega resuelto del servidor en CategoryDTO
// (used/limit/status del mes en vista); acá solo se pinta con el texto de categoryUsageLine y el
// tono del estado (ámbar cerca del tope, óxido al llegar o pasarse). Sin categoría seleccionada, o
// de ingreso (no consume presupuesto), no se muestra.
function CategoryBudgetLine({
  category,
}: {
  category: CategoryDTO | undefined
}) {
  const line = category ? categoryUsageLine(category) : null
  if (!category || !line) return null
  const tone =
    category.status === "bueno"
      ? "default"
      : category.status === "moderado"
        ? "warn"
        : "alert"
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-callout">
        <span className="min-w-0 truncate text-ink-2">
          {category.name} este mes
        </span>
        <span
          className={cn(
            "shrink-0 font-semibold whitespace-nowrap",
            line.color &&
              (tone === "warn"
                ? "text-warning"
                : tone === "alert"
                  ? "text-destructive"
                  : "text-foreground")
          )}
        >
          {line.text}
        </span>
      </div>
      {/* Solo con tope: sin límite no hay proporción que pintar. */}
      {line.color && (
        <ProgressBar
          value={category.used}
          max={category.limit}
          tone={tone}
          label={`Gastado de ${category.name} este mes`}
        />
      )}
    </div>
  )
}

// "Pago cuota 3 de crédito de consumo" → 3. Mismo patrón que usa el import (run-installments):
// la descripción la escribe el parser del banco, no el usuario, así que es estable.
function parseInstallmentNumber(description: string): number | null {
  const m = description.match(/cuota\s+(\d{1,3})\b/i)
  return m ? Number(m[1]) : null
}

// YYYY-MM-DD ↔ Date en horario local (mediodía evita el corrimiento de día por zona horaria).
const parseISODate = (s: string) => new Date(`${s}T12:00:00`)
export const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

// Selector de fecha (Calendar en ResponsivePopover: popover en escritorio, hoja en móvil), en español. Exportado: lo reutiliza el sheet
// de nueva transacción.
export function DatePicker({
  value,
  onChange,
  id,
  invalid,
  describedBy,
  placeholder = "Elegir fecha",
  fromDate,
  toDate,
}: {
  id?: string
  invalid?: boolean
  describedBy?: string
  value: string // "" = sin fecha elegida todavía
  onChange: (v: string) => void
  placeholder?: string
  fromDate?: string // YYYY-MM-DD: días anteriores deshabilitados
  toDate?: string // YYYY-MM-DD: días posteriores deshabilitados
}) {
  const [open, setOpen] = useState(false)
  // Sin valor no hay día seleccionado: el calendario abre en el mes actual y el botón muestra
  // el placeholder, en vez de fingir una fecha que el usuario no eligió.
  const selected = value ? parseISODate(value) : undefined
  return (
    <ResponsivePopover
      open={open}
      onOpenChange={setOpen}
      title={placeholder}
      className="w-auto p-0"
      trigger={
        <Button
          type="button"
          id={id}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          variant="secondary"
          className="w-full min-w-0 justify-start font-normal"
        >
          <CalendarIcon className="text-ink-3" />
          {selected ? (
            // Mes completo y año: en una fecha de vigencia, "25/08" oculta justo el dato que
            // más se equivoca.
            <span className="truncate">
              {selected.toLocaleDateString("es-CL", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          ) : (
            <span className="truncate text-ink-3">{placeholder}</span>
          )}
        </Button>
      }
    >
      <Calendar
        mode="single"
        locale={es}
        selected={selected}
        defaultMonth={selected}
        disabled={[
          ...(fromDate ? [{ before: parseISODate(fromDate) }] : []),
          ...(toDate ? [{ after: parseISODate(toDate) }] : []),
        ]}
        onSelect={(d) => {
          if (!d) return
          onChange(toISODate(d))
          setOpen(false)
        }}
        autoFocus
      />
    </ResponsivePopover>
  )
}

// Movimiento manual → editable (form tipo crear + eliminar). Movimiento conectado → solo lectura.
export function TransactionModal({
  tx,
  categories,
  accounts,
  onOpenChange,
}: {
  tx: TransactionDTO | null
  categories: CategoryDTO[]
  accounts: AccountDTO[]
  onOpenChange: (o: boolean) => void
}) {
  // El movimiento relacionado vale solo para el movimiento con que se pidió:
  // se deriva en render (abrir otro lo descarta) en vez de limpiarlo en un efecto.
  const [related, setRelated] = useState<{ forId: string; tx: TransactionDTO } | null>(null)
  // Al cerrar (tx = null) o abrir otro, se descarta durante el render: si no, reabrir el mismo
  // movimiento mostraría el relacionado que se vio antes.
  if (related && related.forId !== tx?.id) setRelated(null)
  const relatedTx = related && related.forId === tx?.id ? related.tx : null
  const setRelatedTx = (next: TransactionDTO) => tx && setRelated({ forId: tx.id, tx: next })
  const activeTx = relatedTx ?? tx
  const account = activeTx ? accounts.find(a => a.id === activeTx.accountId) : undefined
  // Reembolso y programado del abono: secciones propias que el detalle pone después de la categoría.
  const links = activeTx && (
    <>
      <ReimbursementSection key={activeTx.id} tx={activeTx} onOpenRelated={setRelatedTx} />
      <div className="empty:hidden">
        <IncomeSourceLink key={activeTx.id} tx={activeTx} />
      </div>
    </>
  )
  return (
    <ResponsiveModal
      open={tx !== null}
      onOpenChange={onOpenChange}
      title={activeTx?.editable ? "Editar movimiento" : "Movimiento del banco"}
    >
      {activeTx && (activeTx.editable ? (
        <EditForm key={activeTx.id} tx={activeTx} account={account} accounts={accounts} categories={categories} links={links} onClose={() => onOpenChange(false)} />
      ) : (
        <ConnectedDetail key={activeTx.id} tx={activeTx} account={account} accounts={accounts} categories={categories} links={links} onClose={() => onOpenChange(false)} />
      ))}
    </ResponsiveModal>
  )
}

function EditForm({
  tx,
  account,
  accounts,
  categories,
  links,
  onClose,
}: {
  tx: TransactionDTO
  account: AccountDTO | undefined
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  links?: React.ReactNode
  onClose: () => void
}) {
  const router = useRouter()
  const instanceId = useId()
  const [apiError, setApiError] = useState<string | null>(null)
  const form = useForm<TransactionUpdateFormValues>({
    resolver: zodResolver(transactionEditFormSchema),
    defaultValues: {
      description: tx.description,
      direction: tx.direction === "credit" ? "credit" : "debit",
      categoryId: tx.categoryId,
      date: tx.date.slice(0, 10),
      amount: Math.abs(tx.amount),
    },
  })
  const [direction, categoryId] = useWatch({
    control: form.control,
    name: ["direction", "categoryId"],
  })
  const setCategoryId = (value: string | null) =>
    form.setValue("categoryId", value, { shouldDirty: true })
  const [busy, setBusy] = useState<null | "save" | "delete">(null)
  // La cuota de un plan: su monto es un espejo del cronograma (se edita en el plan, que sincroniza
  // el movimiento) y su categoría es la del plan (cambiarla aquí recategoriza el plan completo).
  const isInstallment = !!tx.installmentItemId
  const [makeRecurring, setMakeRecurring] = useState(false)
  const [makeInstallments, setMakeInstallments] = useState(false)
  const [assignInstallment, setAssignInstallment] = useState(false)
  // La conversión usa el movimiento guardado: nunca adopta un borrador sin guardar.
  const showConversions =
    tx.direction === "debit" &&
    !tx.isInternal &&
    !!tx.categoryId &&
    !tx.recurringTemplateId &&
    !tx.installmentItemId &&
    !tx.installmentSourceCount &&
    !tx.installmentForecast
  const conversionsDisabled = form.formState.isDirty || busy !== null
  const isCreditCard = account?.accountType === "credit_card"

  const canSave =
    form.formState.isDirty && busy === null && !form.formState.isSubmitting

  // Categorías filtradas por el lado elegido (gasto/ingreso); al cambiar de lado se limpia si no calza.
  const visibleCategories = savedFirst(
    categories.filter(
      (c) => c.type === (direction === "credit" ? "income" : "expense")
    ),
    tx.categoryId
  )

  function changeDirection(d: "debit" | "credit") {
    form.setValue("direction", d, { shouldDirty: true })
    const t = d === "credit" ? "income" : "expense"
    if (categoryId && categories.find((c) => c.id === categoryId)?.type !== t)
      setCategoryId(null)
  }

  async function save(input: TransactionUpdateFormValues) {
    setApiError(null)
    setBusy("save")
    try {
      const res = await fetch(`/api/transactions/${tx.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          description: input.description.trim(),
        }),
      })
      if (!res.ok)
        throw new Error(
          await financeResponseError(
            res,
            "No se pudo guardar el movimiento. Inténtalo otra vez."
          )
        )
      haptic("success")
      onClose()
      router.refresh()
    } catch (error) {
      haptic("error")
      setApiError(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el movimiento."
      )
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setApiError(null)
    setBusy("delete")
    haptic("heavy")
    try {
      const res = await fetch(`/api/transactions/${tx.id}`, {
        method: "DELETE",
      })
      if (!res.ok)
        throw new Error(
          await financeResponseError(
            res,
            "No se pudo eliminar el movimiento. Inténtalo otra vez."
          )
        )
      onClose()
      router.refresh()
    } catch (error) {
      haptic("error")
      setApiError(
        error instanceof Error
          ? error.message
          : "No se pudo eliminar el movimiento."
      )
    } finally {
      setBusy(null)
    }
  }

  const conversionsNoteId = `transaction-conversions-${tx.id}-${instanceId}`
  const editor = (
    <form
      id={`edit-transaction-${tx.id}-${instanceId}`}
      onSubmit={form.handleSubmit(save)}
      className="flex flex-col gap-6"
      noValidate
    >
      {apiError && (
        <p
          role="alert"
          className="rounded-md bg-destructive-soft px-3 py-2 text-callout text-destructive"
        >
          {apiError}
        </p>
      )}

      <ModalSection plain title="Datos">
        {accountLabel(account) && (
          <dl className="sheet-group px-4 py-1">
            <ModalDataRow label="Cuenta" value={accountLabel(account)} />
          </dl>
        )}
        <div className="flex flex-col gap-4">
          <FinanceField
            id={`transaction-description-${tx.id}-${instanceId}`}
            label="Descripción"
            error={form.formState.errors.description?.message}
          >
            <Input
              id={`transaction-description-${tx.id}-${instanceId}`}
              {...form.register("description")}
              inputMode="text"
            />
          </FinanceField>
          <div className="flex flex-col gap-2">
            <span className="text-callout font-semibold text-ink-2">
              Tipo de movimiento
            </span>
            <DirectionToggle
              value={direction}
              onChange={changeDirection}
              disabled={isInstallment || busy !== null}
            />
          </div>
          {/* Monto y fecha lado a lado cuando caben; apilados en el teléfono angosto. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-4">
            <Controller
              name="amount"
              control={form.control}
              render={({ field, fieldState }) => (
                <FinanceField
                  id={`transaction-amount-${tx.id}-${instanceId}`}
                  label={`Monto (${tx.currency})`}
                  error={fieldState.error?.message}
                  hint={
                    isInstallment
                      ? "El monto de una cuota se edita en su plan de cuotas."
                      : undefined
                  }
                >
                  <MoneyFormInput
                    id={`transaction-amount-${tx.id}-${instanceId}`}
                    value={field.value}
                    onValueChange={field.onChange}
                    currency={tx.currency as CurrencyCode}
                    readOnly={isInstallment}
                    aria-invalid={!!fieldState.error}
                    aria-describedby={
                      fieldState.error
                        ? `transaction-amount-${tx.id}-${instanceId}-error`
                        : isInstallment
                          ? `transaction-amount-${tx.id}-${instanceId}-hint`
                          : undefined
                    }
                  />
                </FinanceField>
              )}
            />
            <Controller
              name="date"
              control={form.control}
              render={({ field, fieldState }) => (
                <FinanceField
                  id={`transaction-date-${tx.id}-${instanceId}`}
                  label="Fecha"
                  error={fieldState.error?.message}
                >
                  <DatePicker
                    id={`transaction-date-${tx.id}-${instanceId}`}
                    value={field.value}
                    onChange={field.onChange}
                    invalid={!!fieldState.error}
                    describedBy={
                      fieldState.error
                        ? `transaction-date-${tx.id}-${instanceId}-error`
                        : undefined
                    }
                  />
                </FinanceField>
              )}
            />
          </div>
        </div>
      </ModalSection>

      <ModalSection plain title="Categoría">
        <CategoryBudgetLine
          category={categories.find((c) => c.id === categoryId)}
        />
        {visibleCategories.length === 0 ? (
          <p className="text-callout text-ink-2">
            Sin categorías de {direction === "credit" ? "ingreso" : "gasto"}.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {/* Sin categoría solo si NO es recurrente ni cuota: plantilla y plan exigen una,
                  y quitarla aquí los dejaría sin la suya. */}
              {!tx.recurringTemplateId && !isInstallment && (
                <Chip
                  active={categoryId === null}
                  onClick={() => setCategoryId(null)}
                >
                  <CircleDashed size={16} /> Sin categoría
                </Chip>
              )}
              {visibleCategories.map((c) => (
                <Chip
                  key={c.id}
                  active={c.id === categoryId}
                  // Tocar la activa la deselecciona… salvo en un recurrente o una cuota, que no
                  // pueden quedarse sin categoría.
                  onClick={() =>
                    setCategoryId(
                      c.id === categoryId &&
                        !tx.recurringTemplateId &&
                        !isInstallment
                        ? null
                        : c.id
                    )
                  }
                >
                  <CategoryIcon
                    icon={c.icon}
                    size={16}
                    color={c.color ?? undefined}
                  />{" "}
                  {c.name}
                </Chip>
              ))}
            </div>
            {tx.recurringTemplateId && (
              <p className="text-caption text-ink-3">
                Cambiarla también recategoriza la recurrencia. Para dejarlo sin
                categoría, elimina antes la recurrencia.
              </p>
            )}
            {isInstallment && (
              <p className="text-caption text-ink-3">
                Cambiarla recategoriza el plan de cuotas completo: todas sus
                cuotas y la compra original.
              </p>
            )}
          </>
        )}
      </ModalSection>

      {links}

      {/* Acciones: convertir el movimiento (abren su propio formulario) y eliminarlo, al final. */}
      <ModalSection
        title="Acciones"
        footer={
          showConversions &&
          form.formState.isDirty && (
            <span id={conversionsNoteId}>
              Guarda los cambios antes de hacer recurrente o pasar a cuotas.
            </span>
          )
        }
      >
          {showConversions && (
            <>
              <button
                type="button"
                disabled={conversionsDisabled}
                aria-describedby={
                  form.formState.isDirty ? conversionsNoteId : undefined
                }
                onClick={() => {
                  haptic("light")
                  setMakeRecurring(true)
                }}
                className={modalActionRow}
              >
                <Repeat aria-hidden className="text-ink-2" />
                <span className="min-w-0 flex-1">Hacer recurrente</span>
                <ChevronRight aria-hidden className="size-4! text-ink-3" />
              </button>
              <button
                type="button"
                disabled={conversionsDisabled}
                aria-describedby={
                  form.formState.isDirty ? conversionsNoteId : undefined
                }
                onClick={() => {
                  haptic("light")
                  if (isCreditCard) setMakeInstallments(true)
                  else setAssignInstallment(true)
                }}
                className={modalActionRow}
              >
                <CreditCard aria-hidden className="text-ink-2" />
                <span className="min-w-0 flex-1">
                  {isCreditCard ? "Pasar a cuotas" : "Es una cuota"}
                </span>
                <ChevronRight aria-hidden className="size-4! text-ink-3" />
              </button>
            </>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <ModalDangerRow
                type="button"
                disabled={busy !== null}
              >
                <Trash2 aria-hidden />
                <span className="min-w-0 flex-1">Eliminar movimiento</span>
              </ModalDangerRow>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                {/* El texto sale de lo GUARDADO (tx.direction), no del lado elegido en pantalla:
                    se borra el movimiento tal como está en la base, no como quedó el formulario. */}
                <AlertDialogTitle>
                  {deleteCopy(tx.direction === "credit").title}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {deleteCopy(tx.direction === "credit").description}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
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
      </ModalSection>

      <ModalActions
        cancel={{
          label: "Cancelar",
          onClick: onClose,
          disabled: busy !== null,
        }}
        primary={{
          label: "Guardar",
          form: `edit-transaction-${tx.id}-${instanceId}`,
          busy: busy === "save",
          disabled: !canSave,
        }}
      />
    </form>
  )


  return (
    <>
      {editor}
      {/* Los formularios de conversión son hermanos del editor, nunca formularios anidados. */}
      {makeRecurring && (
        <RecurringModal
          open
          onOpenChange={setMakeRecurring}
          onSaved={onClose}
          accounts={accounts}
          categories={categories}
          preset={{
            label: tx.description,
            accountId: tx.accountId,
            categoryId: tx.categoryId,
            baseAmount: Math.abs(tx.amount),
            dayOfMonth: new Date(tx.date).getUTCDate(),
            sourceTransactionId: tx.id,
          }}
        />
      )}
      {makeInstallments && (
        <InstallmentModal
          open
          onOpenChange={setMakeInstallments}
          onCreated={onClose}
          accounts={accounts}
          categories={categories}
          kind="card"
          preset={{
            description: tx.description,
            accountId: tx.accountId,
            categoryId: tx.categoryId,
            totalAmount: Math.abs(tx.amount),
            sourceTransactionId: tx.id,
          }}
        />
      )}
      {assignInstallment && (
        <AssignToInstallmentModal
          open
          onOpenChange={setAssignInstallment}
          transactionId={tx.id}
          onAssigned={onClose}
        />
      )}
    </>
  )
}

// Movimiento del banco: datos de solo lectura, pero SÍ se puede asignar/cambiar la categoría.
function ConnectedDetail({
  tx,
  account,
  accounts,
  categories,
  links,
  onClose,
}: {
  tx: TransactionDTO
  account: AccountDTO | undefined
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  links?: React.ReactNode
  onClose: () => void
}) {
  const router = useRouter()
  const income = tx.direction === "credit"
  const [categoryId, setCategoryId] = useState<string | null>(tx.categoryId)
  const [saving, setSaving] = useState(false)
  // Paso de aprendizaje tras guardar: pregunta el "porqué" (opcional) y ofrece propagar la
  // categoría a los N movimientos con la misma descripción. La categoría ya quedó persistida.
  const [learn, setLearn] = useState<{
    sameTextCount: number
    learnedCategoryId: string | null
  } | null>(null)
  // Estado de la plantilla que generó este movimiento: llega resuelto en el DTO desde el servidor.
  // Optimista tras pausar/reanudar; `router.refresh()` trae el valor real.
  const [recurringActive, setRecurringActive] = useState(
    tx.recurringIsActive !== false
  )
  // Crear recurrente abre el formulario precargado: el usuario ajusta título, rango y periodicidad
  // antes de confirmar. Nunca se crea directo desde el movimiento.
  const [makeRecurring, setMakeRecurring] = useState(false)
  const [makeInstallments, setMakeInstallments] = useState(false)
  const [assignInstallment, setAssignInstallment] = useState(false)
  const [makeLoan, setMakeLoan] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDeleteTx, setConfirmDeleteTx] = useState(false)
  const changed = categoryId !== tx.categoryId
  const isCreditCard = account?.accountType === "credit_card"
  // Pertenece a un plan de cuotas (cuota registrada, cuota proyectada o compra origen): la
  // categoría es del PLAN — cambiarla aquí recategoriza el plan y todos sus movimientos, y no
  // puede quedar sin categoría.
  const inInstallmentPlan =
    !!tx.installmentItemId || !!tx.installmentSourceCount
  // Acciones de conversión del footer (recurrente / cuotas): solo gastos categorizados que no
  // pertenecen ya a un plan.
  const showConversions =
    !tx.recurringTemplateId &&
    !income &&
    !!tx.categoryId &&
    !tx.installmentItemId &&
    !tx.installmentSourceCount
  // Solo categorías del mismo lado del movimiento (ingreso ↔ credit, gasto ↔ debit).
  const visibleCategories = savedFirst(
    categories.filter((c) => c.type === (income ? "income" : "expense")),
    tx.categoryId
  )

  // Una acción del detalle: `saving` se suelta siempre (también si la red falla) y el fallo se
  // avisa; devuelve la respuesta solo si salió bien.
  async function run(request: () => Promise<Response>, failure: string) {
    setSaving(true)
    try {
      const res = await request()
      if (res.ok) return res
    } catch {
      // Sin red: mismo aviso que un rechazo.
    } finally {
      setSaving(false)
    }
    haptic("error")
    toast.error(failure)
    return null
  }

  async function saveCategory() {
    // Una cuota proyectada no es una transacción: recategorizarla es recategorizar su plan.
    const res = await run(
      () =>
        fetch(
          tx.installmentForecast
            ? `/api/installments/${tx.installmentPlanId}`
            : `/api/transactions/${tx.id}/category`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ categoryId }),
          }
        ),
      "No se pudo guardar la categoría"
    )
    if (!res) return
    haptic("success")
    // Quitar categoría no aprende nada; una cuota proyectada tampoco (no hay texto del banco).
    if (!categoryId || tx.installmentForecast) {
      onClose()
      router.refresh()
      return
    }
    const data = await res.json().catch(() => ({}))
    setLearn({
      sameTextCount: Number(data.sameTextCount) || 0,
      learnedCategoryId: data.learnedCategoryId ?? null,
    })
  }

  // Pausa/reanuda la plantilla que generó este movimiento. Pausada no ejecuta los períodos
  // siguientes; lo ya cobrado queda intacto.
  async function toggleRecurring() {
    if (!tx.recurringTemplateId) return
    const res = await run(
      () =>
        fetch(`/api/recurring/${tx.recurringTemplateId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !recurringActive }),
        }),
      "No se pudo cambiar la recurrencia"
    )
    if (!res) return
    haptic("success")
    setRecurringActive(!recurringActive)
    toast.success(
      recurringActive ? "Recurrencia pausada" : "Recurrencia reanudada"
    )
    router.refresh()
  }

  // Elimina la plantilla. Los movimientos ya cobrados se conservan (solo pierden el vínculo);
  // el comprometido del período en curso, que no ocurrió, se va con ella.
  async function deleteRecurring() {
    if (!tx.recurringTemplateId) return
    haptic("heavy") // destructiva: borra la plantilla
    const res = await run(
      () => fetch(`/api/recurring/${tx.recurringTemplateId}`, { method: "DELETE" }),
      "No se pudo eliminar la recurrencia"
    )
    if (!res) return
    haptic("success")
    toast.success(
      "Recurrencia eliminada; los movimientos cobrados se conservan"
    )
    onClose()
    router.refresh()
  }

  // Elimina el movimiento (abono o cargo). El backend revierte su efecto en el saldo de la cuenta.
  async function removeTx() {
    haptic("heavy") // destructiva
    const res = await run(
      () => fetch(`/api/transactions/${tx.id}`, { method: "DELETE" }),
      "No se pudo eliminar el movimiento"
    )
    if (!res) return
    haptic("success")
    toast.success(
      income
        ? "Ingreso eliminado; el saldo bajó"
        : "Gasto eliminado; el saldo subió"
    )
    onClose()
    router.refresh()
  }

  async function finishLearn({
    note,
    applyToSameText,
  }: {
    note: string
    applyToSameText: boolean
  }) {
    setSaving(true)
    try {
      if (note.trim() || applyToSameText) {
        // Best-effort: la categoría ya está guardada; si el follow-up falla, no bloquea el cierre.
        await fetch("/api/categorization/corrections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionId: tx.id,
            note: note.trim() || undefined,
            applyToSameText,
          }),
        }).catch(() => {})
        haptic(applyToSameText ? "success" : "light")
      }
    } finally {
      setSaving(false)
    }
    onClose()
    router.refresh()
  }

  if (learn) {
    return (
      <div className="flex flex-col gap-6">
        <CorrectionLearnStep
          description={tx.description}
          sameTextCount={learn.sameTextCount}
          learnedCategoryName={
            categories.find((c) => c.id === learn.learnedCategoryId)?.name ??
            null
          }
          saving={saving}
          onFinish={finishLearn}
        />
      </div>
    )
  }

  const statusKey =
    tx.status === "pending" && (tx.recurringTemplateId || tx.installmentForecast)
      ? "committed"
      : tx.status
  const hasActions =
    !!tx.recurringTemplateId ||
    showConversions ||
    ((income || !tx.categoryId || !!tx.duplicateInstallmentPayment) &&
      !inInstallmentPlan &&
      !tx.installmentForecast)

  return (
    <div className="flex flex-col gap-6">
      {/* La cifra del movimiento, con signo (y en verde si es ingreso), y debajo qué fue. */}
      <div className="flex flex-col gap-1">
        <p
          className={cn(
            "text-title font-semibold whitespace-nowrap",
            income && !tx.isInternal && "text-success"
          )}
        >
          {income ? "+" : "−"}
          {tx.currency === "CLP"
            ? formatCLP(Math.abs(tx.amount))
            : formatMoney(Math.abs(tx.amount), tx.currency as CurrencyCode)}
        </p>
        {tx.amountClp != null && (
          <p className="text-callout text-ink-2">
            ≈ {formatCLP(Math.abs(tx.amountClp))} con el dólar del día
          </p>
        )}
        <p className="text-body break-words">{tx.description}</p>
        <div className="mt-2 flex flex-wrap gap-2 empty:hidden">
          {tx.status === "pending" && (
            <Badge variant="warning">{STATUS_LABEL[statusKey]}</Badge>
          )}
          {tx.recurringTemplateId && (
            <Badge variant="secondary">
              {recurringActive ? "Recurrente" : "Recurrente · pausada"}
            </Badge>
          )}
          {tx.isInternal && <Badge variant="secondary">Ajuste de saldo</Badge>}
        </div>
      </div>

      <ModalSection plain title="Datos">
        <dl className="sheet-group px-4 py-1">
          {account && (
            <ModalDataRow label="Banco" value={account.bankName || account.name} />
          )}
          {account && (
            <ModalDataRow
              label="Tarjeta"
              value={
                account.cardLast4 ? `•••• ${account.cardLast4}` : account.name
              }
            />
          )}
          <ModalDataRow label="Fecha" value={fullDate(tx.date)} />
          <ModalDataRow label="Tipo" value={income ? "Ingreso" : "Gasto"} />
          <ModalDataRow label="Estado" value={STATUS_LABEL[statusKey] ?? tx.status} />
          {tx.recurringTemplateId && (
            <ModalDataRow
              label="Recurrencia"
              value={recurringActive ? "Activa" : "Pausada"}
            />
          )}
          {/* Hasta cuándo sigue cobrándose: se decide una vez y después se olvida, así que se
              muestra donde el movimiento se consulta. */}
          {tx.recurringTemplateId && (
            <ModalDataRow
              label="Vigencia"
              value={
                tx.recurringEndDate
                  ? `Hasta el ${fullDate(tx.recurringEndDate)}`
                  : "Sin fecha de término"
              }
            />
          )}
          {/* ponytail: solo el hecho de que está asignado, sin el nombre del plan ni el número de
              cuota — traerlos obligaría a unir plan e ítem en todas las consultas de movimientos.
              El detalle y el "soltar" viven en la vista del plan, a un toque. */}
          {tx.installmentItemId && (
            <ModalDataRow
              label="Cuotas"
              value={
                <Link href="/recurring#cuotas" className={DATA_LINK}>
                  Es la cuota de un plan
                </Link>
              }
            />
          )}
          {/* Esta compra se repartió en cuotas: por eso ya no cuenta como gasto (cada cuota lo hace en
              su mes). Sin el sello se vería como un movimiento interno sin explicación. */}
          {tx.installmentSourceCount && (
            <ModalDataRow
              label="Cuotas"
              value={
                <Link href="/recurring#cuotas" className={DATA_LINK}>
                  Compra en {tx.installmentSourceCount} cuotas
                </Link>
              }
            />
          )}
        </dl>
      </ModalSection>

      <ModalSection plain title="Categoría">
        <CategoryBudgetLine
          category={categories.find((c) => c.id === categoryId)}
        />
        {visibleCategories.length === 0 ? (
          <p className="text-callout text-ink-2">
            Sin categorías de {income ? "ingreso" : "gasto"}. Crea una para
            clasificar este movimiento.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {/* Sin categoría solo si NO es recurrente ni de un plan de cuotas: plantilla y plan
                  exigen una, y quitarla aquí los dejaría sin la suya. */}
              {!tx.recurringTemplateId && !inInstallmentPlan && (
                <Chip
                  active={categoryId === null}
                  onClick={() => setCategoryId(null)}
                >
                  <CircleDashed size={16} /> Sin categoría
                </Chip>
              )}
              {visibleCategories.map((c) => (
                <Chip
                  key={c.id}
                  active={c.id === categoryId}
                  // Tocar la activa la deselecciona… salvo en un recurrente o un plan de cuotas,
                  // que no pueden quedarse sin categoría.
                  onClick={() =>
                    setCategoryId(
                      c.id === categoryId &&
                        !tx.recurringTemplateId &&
                        !inInstallmentPlan
                        ? null
                        : c.id
                    )
                  }
                >
                  <CategoryIcon
                    icon={c.icon}
                    size={16}
                    color={c.color ?? undefined}
                  />{" "}
                  {c.name}
                </Chip>
              ))}
            </div>
            {tx.recurringTemplateId && (
              <p className="text-caption text-ink-3">
                Cambiarla también recategoriza la recurrencia. Para dejarlo sin
                categoría, elimina antes la recurrencia.
              </p>
            )}
            {inInstallmentPlan && (
              <p className="text-caption text-ink-3">
                Cambiarla recategoriza el plan de cuotas completo: todas sus
                cuotas y la compra original.
              </p>
            )}
          </>
        )}
      </ModalSection>

      {links}

      {/* Acciones en filas a ancho completo: la recurrencia que generó el movimiento (pausar y
          eliminar), convertirlo y eliminarlo. Lo destructivo va al final, en óxido y con
          confirmación. Descubrimiento: crear la recurrente se queda a la vista. Una compra ya
          repartida en cuotas no admite recurrente ni volver a pasarse a cuotas. En crédito, el
          movimiento es la COMPRA y se reparte en cuotas: el plan la reemplaza. En cualquier otra
          cuenta, el movimiento ES una cuota de una deuda que ya existe, y lo que corresponde es
          asignarlo — no crear nada. */}
      {hasActions && (
        <ModalSection title="Acciones">
            {tx.recurringTemplateId && (
              <button
                type="button"
                onClick={toggleRecurring}
                disabled={saving}
                className={modalActionRow}
              >
                {recurringActive ? (
                  <PauseCircle aria-hidden className="text-ink-2" />
                ) : (
                  <PlayCircle aria-hidden className="text-ink-2" />
                )}
                <span className="min-w-0 flex-1">
                  {recurringActive ? "Pausar recurrencia" : "Reanudar recurrencia"}
                </span>
              </button>
            )}
            {!tx.recurringTemplateId && showConversions && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    haptic("light")
                    setMakeRecurring(true)
                  }}
                  disabled={saving}
                  className={modalActionRow}
                >
                  <Repeat aria-hidden className="text-ink-2" />
                  <span className="min-w-0 flex-1">Hacer recurrente</span>
                  <ChevronRight aria-hidden className="size-4! text-ink-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    haptic("light")
                    if (isCreditCard) setMakeInstallments(true)
                    else setAssignInstallment(true)
                  }}
                  disabled={saving}
                  className={modalActionRow}
                >
                  <CreditCard aria-hidden className="text-ink-2" />
                  <span className="min-w-0 flex-1">
                    {isCreditCard ? "Pasar a cuotas" : "Es una cuota"}
                  </span>
                  <ChevronRight aria-hidden className="size-4! text-ink-3" />
                </button>
              </>
            )}
            {tx.recurringTemplateId && (
              <ModalDangerRow
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
              >
                <Trash2 aria-hidden />
                <span className="min-w-0 flex-1">Eliminar recurrencia</span>
              </ModalDangerRow>
            )}
            {/* Eliminar: los ingresos (los abona el usuario) y los gastos SIN categoría — ruido del
                banco que nadie clasificó— y cobros sobrantes de cuotas verificados por el servidor.
                Se mira la categoría GUARDADA, no la elegida en pantalla.
                Nunca los generados por recurrencia o plan de cuotas: se gestionan en su origen. */}
            {(income || !tx.categoryId || tx.duplicateInstallmentPayment) &&
              !tx.recurringTemplateId &&
              !inInstallmentPlan &&
              !tx.installmentForecast && (
                <ModalDangerRow
                  type="button"
                  onClick={() => setConfirmDeleteTx(true)}
                  disabled={saving}
                >
                  <Trash2 aria-hidden />
                  <span className="min-w-0 flex-1">
                    {income ? "Eliminar ingreso" : "Eliminar gasto"}
                  </span>
                </ModalDangerRow>
              )}
        </ModalSection>
      )}
      <ModalActions
        cancel={{ label: "Cerrar", onClick: onClose, disabled: saving }}
        primary={{
          label: "Guardar categoría",
          onClick: saveCategory,
          busy: saving,
          disabled: !changed || saving,
        }}
      />

      <AlertDialog open={confirmDeleteTx} onOpenChange={setConfirmDeleteTx}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteCopy(income).title}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCopy(income).description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={removeTx}
              variant="destructive"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la recurrencia?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra la plantilla y deja de cobrarse. Los movimientos ya
              cobrados se conservan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={deleteRecurring}
              variant="destructive"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Este movimiento pasa a SER la cuota de un plan existente: no se crea nada. Cubre lo que
          el enganche automático no alcanza (plan creado después del cargo, pago ambiguo entre dos
          créditos, descripción distinta a la esperada). Si la deuda aún no existe como plan, la
          salida es registrar el crédito desde aquí. */}
      {assignInstallment && (
        <AssignToInstallmentModal
          open
          onOpenChange={setAssignInstallment}
          transactionId={tx.id}
          onAssigned={onClose}
          onCreateLoan={() => {
            setAssignInstallment(false)
            setMakeLoan(true)
          }}
        />
      )}

      {/* Registrar el crédito de consumo cuya cuota es este movimiento. El N° de cuota y la fecha
          del pago precargan el desfase y el calendario; al crear, el enganche automático adopta
          este pago como su cuota (no se crea gasto nuevo). */}
      {makeLoan && (
        <InstallmentModal
          open
          onOpenChange={setMakeLoan}
          onCreated={onClose}
          accounts={accounts}
          categories={categories}
          kind="loan"
          preset={{
            accountId: tx.accountId,
            // La seleccionada en pantalla, no la persistida: es la que el usuario está viendo.
            categoryId: categoryId ?? tx.categoryId,
            startIndex: parseInstallmentNumber(tx.description) ?? undefined,
            dayOfMonth: new Date(tx.date).getUTCDate(),
            startMonth: tx.date.slice(0, 7),
          }}
        />
      )}

      {/* Cronograma precargado con esta compra. Al confirmarlo, la compra queda neutralizada (deja
          de contar como gasto) y el plan la reemplaza por una cuota al mes. La categoría es la
          SELECCIONADA en pantalla, no la persistida: es la que el usuario está viendo. */}
      {makeInstallments && (
        <InstallmentModal
          open
          onOpenChange={setMakeInstallments}
          onCreated={onClose}
          accounts={accounts}
          categories={categories}
          kind="card"
          preset={{
            description: tx.description,
            accountId: tx.accountId,
            categoryId: categoryId ?? tx.categoryId,
            totalAmount: Math.abs(tx.amount),
            sourceTransactionId: tx.id,
          }}
        />
      )}

      {/* Formulario de la nueva plantilla, precargado con este movimiento. Al guardarse cierra
          también el detalle: la lista de abajo ya se refrescó. */}
      {makeRecurring && (
        <RecurringModal
          open
          onOpenChange={setMakeRecurring}
          onSaved={onClose}
          accounts={accounts}
          categories={categories}
          preset={{
            label: tx.description, // nombre inicial editable; la clave de match sale del cargo real
            accountId: tx.accountId,
            categoryId: tx.categoryId,
            baseAmount: Math.abs(tx.amount),
            dayOfMonth: new Date(tx.date).getUTCDate(),
            sourceTransactionId: tx.id,
          }}
        />
      )}
    </div>
  )
}

// Enlace dentro de un dato (lleva al plan de cuotas).
const DATA_LINK =
  "font-semibold text-primary underline-offset-2 hover:underline"

// Toggle − / + del lado del movimiento (exportado: lo reutiliza el alta desde el FAB).
export function DirectionToggle({
  value,
  onChange,
  disabled,
}: {
  value: Direction
  onChange: (d: Direction) => void
  disabled?: boolean
}) {
  // El segmentado de iOS, como el resto de la app: la selección no cambia de color según el lado.
  return (
    <Segmented
      label="Tipo de movimiento"
      value={value}
      disabled={disabled}
      onChange={(d) => {
        haptic("light")
        onChange(d)
      }}
      options={[
        { value: "debit", label: "− Gasto" },
        { value: "credit", label: "+ Ingreso" },
      ]}
      className="w-full"
    />
  )
}

// Chip de categoría (exportado: lo reutiliza el triage). `disabled` mientras se persiste. El elegido
// va en acento suave con borde de acento y semibold: se distingue sin depender solo del color.
export function Chip({
  active,
  onClick,
  disabled,
  children,
}: {
  active?: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic("light") // selección de chip
        onClick()
      }}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "press flex min-h-(--ctl) max-w-full shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-left text-callout transition-colors disabled:opacity-45 pointer-coarse:min-h-11",
        active
          ? "bg-primary-soft font-semibold text-primary ring-2 ring-primary ring-inset"
          : "bg-secondary text-ink-2 hover:bg-surface-3 hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}
