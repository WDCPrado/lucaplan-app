"use client"

import * as React from "react"
import { useEffect, useId, useState } from "react"
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
} from "lucide-react"
import { toast } from "sonner"
import {
  ModalActions,
  ModalDangerRow,
  ModalSection,
  ResponsiveModal,
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
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { CorrectionLearnStep } from "./correction-learn-step"
import { RecurringModal } from "./recurring-modal"
import { InstallmentModal } from "./installment-modal"
import { AssignToInstallmentModal } from "./assign-to-installment-modal"
import { CategoryIcon } from "./category-icons"
import { Segmented } from "./segmented"
import {
  categoryUsageLine,
  formatCLP,
  formatMoney,
  usageBarPct,
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

// Uso del presupuesto del mes de la categoría SELECCIONADA en los chips, bajo el título del
// movimiento: justo al categorizar es cuando sirve saber cómo viene la categoría. El dato llega
// resuelto del servidor en CategoryDTO (used/limit/status del mes en vista); acá solo se pinta con
// el semáforo y el texto que ya usa el dashboard (categoryUsageLine → statusVar/formatCLP). Sin
// categoría seleccionada, o de ingreso (no consume presupuesto), no se muestra.
function CategoryBudgetLine({
  category,
}: {
  category: CategoryDTO | undefined
}) {
  const line = category ? categoryUsageLine(category) : null
  if (!category || !line) return null
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-3 text-footnote">
        <span className="truncate text-muted-foreground">
          {category.name} este mes
        </span>
        <span
          className={cn(
            "tabular shrink-0 font-medium",
            !line.color && "text-muted-foreground"
          )}
          style={line.color ? { color: line.color } : undefined}
        >
          {line.text}
        </span>
      </div>
      {/* Misma barra que las categorías del dashboard: pista muted, relleno del semáforo. Solo
          con tope: sin límite no hay proporción que pintar. */}
      {line.color && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full transition-[width] duration-500 ease-out"
            style={{
              width: `${usageBarPct(category.used, category.limit)}%`,
              background: line.color,
            }}
          />
        </div>
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

// Selector de fecha shadcn (Calendar + Popover), en español. Exportado: lo reutiliza el sheet
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          variant="outline"
          className="h-12 w-full min-w-0 justify-start rounded-lg text-body font-normal"
        >
          <CalendarIcon className="size-4 text-muted-foreground" />
          {selected ? (
            // Mes completo y año: en una fecha de vigencia, "25/08" oculta justo el dato que
            // más se equivoca.
            selected.toLocaleDateString("es-CL", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })
          ) : (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
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
      </PopoverContent>
    </Popover>
  )
}

// Movimiento manual → editable (form tipo crear + eliminar). Movimiento conectado → solo lectura.
type ReimbursementCounterpart = { id: string; amount: number; transaction: TransactionDTO }

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
  const [relatedTx, setRelatedTx] = useState<TransactionDTO | null>(null)
  const activeTx = relatedTx ?? tx
  const [links, setLinks] = useState<ReimbursementCounterpart[]>([])
  useEffect(() => { setRelatedTx(null) }, [tx?.id])
  useEffect(() => {
    setLinks([])
    if (!activeTx?.reimbursementCount) return
    const controller = new AbortController()
    fetch(`/api/transactions/${activeTx.id}/reimbursements`, { signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error("No se pudieron cargar los movimientos relacionados"); return res.json() })
      .then((data: { links: ReimbursementCounterpart[] }) => { if (!controller.signal.aborted) setLinks(data.links) })
      .catch(() => { /* Modal sigue utilizable aunque falle la consulta de enlaces. */ })
    return () => controller.abort()
  }, [activeTx?.id, activeTx?.reimbursementCount])
  const account = activeTx ? accounts.find(a => a.id === activeTx.accountId) : undefined
  return (
    <ResponsiveModal
      open={tx !== null}
      onOpenChange={onOpenChange}
      title={activeTx?.editable ? "Editar movimiento" : "Movimiento del banco"}
    >
      {!!links.length && (
        <div className="mb-6 px-5">
        <ModalSection title="Reembolso vinculado">
          {links.map(link => (
            <button key={link.id} type="button" onClick={() => setRelatedTx(link.transaction)}
              className="press flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left">
              <span className="min-w-0"><span className="block truncate text-subheadline font-medium">{link.transaction.description}</span>
                <span className="block text-footnote text-muted-foreground">{link.transaction.date.slice(0, 10)} · {link.transaction.direction === "credit" ? "Ingreso recibido" : "Compra original"}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-subheadline font-semibold tabular-nums">${link.amount.toLocaleString("es-CL")} CLP<ChevronRight aria-hidden className="disclosure" /></span>
            </button>
          ))}
        </ModalSection>
        </div>
      )}
      {activeTx && (activeTx.editable ? (
        <EditForm key={activeTx.id} tx={activeTx} account={account} accounts={accounts} categories={categories} onClose={() => onOpenChange(false)} />
      ) : (
        <ConnectedDetail key={activeTx.id} tx={activeTx} account={account} accounts={accounts} categories={categories} onClose={() => onOpenChange(false)} />
      ))}
    </ResponsiveModal>
  )
}

function EditForm({
  tx,
  account,
  accounts,
  categories,
  onClose,
}: {
  tx: TransactionDTO
  account: AccountDTO | undefined
  accounts: AccountDTO[]
  categories: CategoryDTO[]
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

  const editor = (
    <form
      id={`edit-transaction-${tx.id}-${instanceId}`}
      onSubmit={form.handleSubmit(save)}
      className="flex flex-col gap-6 px-5"
      noValidate
    >
      {apiError && (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 p-3 text-subheadline text-destructive"
        >
          {apiError}
        </p>
      )}
      <FinanceField
        id={`transaction-description-${tx.id}-${instanceId}`}
        label="Descripción"
        error={form.formState.errors.description?.message}
      >
        <Input
          id={`transaction-description-${tx.id}-${instanceId}`}
          {...form.register("description")}
          inputMode="text"
          className="h-12 text-body"
        />
      </FinanceField>
      <div className="flex flex-col gap-3">
        <span className="text-subheadline font-medium">Tipo de movimiento</span>
        <DirectionToggle
          value={direction}
          onChange={changeDirection}
          disabled={isInstallment || busy !== null}
        />
      </div>
      <Controller
        name="amount"
        control={form.control}
        render={({ field, fieldState }) => (
          <FinanceField
            id={`transaction-amount-${tx.id}-${instanceId}`}
            label={`Monto (${tx.currency})`}
            error={fieldState.error?.message}
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
                  : undefined
              }
            />
          </FinanceField>
        )}
      />
      {isInstallment && (
        <p className="text-subheadline text-muted-foreground">
          El monto de una cuota se edita en su plan de cuotas.
        </p>
      )}

      <CategoryBudgetLine
        category={categories.find((c) => c.id === categoryId)}
      />

      {accountLabel(account) && (
        <div className="flex items-center gap-2 text-subheadline text-muted-foreground">
          <CreditCard className="size-4 shrink-0" />
          <span className="truncate">{accountLabel(account)}</span>
        </div>
      )}

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

      <div>
        <Label className="mb-1 block text-footnote">Categoría</Label>
        {visibleCategories.length === 0 ? (
          <p className="text-subheadline text-muted-foreground">
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
              <p className="mt-2 text-footnote text-muted-foreground">
                Cambiarla también recategoriza la recurrencia. Para dejarlo sin
                categoría, elimina antes la recurrencia.
              </p>
            )}
            {isInstallment && (
              <p className="mt-2 text-footnote text-muted-foreground">
                Cambiarla recategoriza el plan de cuotas completo: todas sus
                cuotas y la compra original.
              </p>
            )}
          </>
        )}
      </div>

      {/* Convertir el movimiento: filas de una lista agrupada que abren su propio formulario. */}
      {showConversions && (
        <ModalSection
          className="[--inset:3rem]"
          footer={
            form.formState.isDirty && (
              <p id={`transaction-conversions-${tx.id}-${instanceId}`}>
                Guarda los cambios antes de hacer recurrente o pasar a cuotas.
              </p>
            )
          }
        >
          <button
            type="button"
            disabled={conversionsDisabled}
            aria-describedby={
              form.formState.isDirty
                ? `transaction-conversions-${tx.id}-${instanceId}`
                : undefined
            }
            onClick={() => {
              haptic("light")
              setMakeRecurring(true)
            }}
            className={NAV_ROW}
          >
            <Repeat className="size-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">Hacer recurrente</span>
            <ChevronRight aria-hidden className="disclosure" />
          </button>
          <button
            type="button"
            disabled={conversionsDisabled}
            aria-describedby={
              form.formState.isDirty
                ? `transaction-conversions-${tx.id}-${instanceId}`
                : undefined
            }
            onClick={() => {
              haptic("light")
              if (isCreditCard) setMakeInstallments(true)
              else setAssignInstallment(true)
            }}
            className={NAV_ROW}
          >
            <CreditCard className="size-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              {isCreditCard ? "Pasar a cuotas" : "Es una cuota"}
            </span>
            <ChevronRight aria-hidden className="disclosure" />
          </button>
        </ModalSection>
      )}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <ModalDangerRow disabled={busy !== null}>
              Eliminar movimiento
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
                {busy === "delete" ? "Borrando…" : "Eliminar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      <ModalActions
        cancel={{
          label: "Cancelar",
          onClick: onClose,
          disabled: busy !== null,
        }}
        primary={{
          label: busy === "save" ? "Guardando…" : "Guardar",
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
  onClose,
}: {
  tx: TransactionDTO
  account: AccountDTO | undefined
  accounts: AccountDTO[]
  categories: CategoryDTO[]
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

  async function saveCategory() {
    setSaving(true)
    // Una cuota proyectada no es una transacción: recategorizarla es recategorizar su plan.
    const res = tx.installmentForecast
      ? await fetch(`/api/installments/${tx.installmentPlanId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryId }),
        })
      : await fetch(`/api/transactions/${tx.id}/category`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryId }),
        })
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return
    }
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
    setSaving(true)
    const res = await fetch(`/api/recurring/${tx.recurringTemplateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !recurringActive }),
    })
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return toast.error("No se pudo cambiar la recurrencia")
    }
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
    setSaving(true)
    haptic("heavy") // destructiva: borra la plantilla
    const res = await fetch(`/api/recurring/${tx.recurringTemplateId}`, {
      method: "DELETE",
    })
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return toast.error("No se pudo eliminar la recurrencia")
    }
    haptic("success")
    toast.success(
      "Recurrencia eliminada; los movimientos cobrados se conservan"
    )
    onClose()
    router.refresh()
  }

  // Elimina el movimiento (abono o cargo). El backend revierte su efecto en el saldo de la cuenta.
  async function removeTx() {
    setSaving(true)
    haptic("heavy") // destructiva
    const res = await fetch(`/api/transactions/${tx.id}`, { method: "DELETE" })
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return toast.error("No se pudo eliminar el movimiento")
    }
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
    setSaving(false)
    onClose()
    router.refresh()
  }

  if (learn) {
    return (
      <div className="flex flex-col gap-6 px-5 pb-6">
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

  return (
    <div className="flex flex-col gap-8 px-5">
      <div className="flex flex-col items-center gap-1 pt-2 text-center">
        <div
          className={`tabular text-large-title font-bold ${income ? "text-success" : "text-foreground"}`}
        >
          {income ? "+" : "−"}
          {tx.currency === "CLP"
            ? formatCLP(Math.abs(tx.amount))
            : formatMoney(Math.abs(tx.amount), tx.currency as CurrencyCode)}
        </div>
        {tx.amountClp != null && (
          <div className="tabular text-subheadline text-muted-foreground">
            ≈ {formatCLP(Math.abs(tx.amountClp))} · dólar del día
          </div>
        )}
        <div className="text-subheadline text-balance text-muted-foreground">
          {tx.description}
        </div>
      </div>

      <CategoryBudgetLine
        category={categories.find((c) => c.id === categoryId)}
      />

      <dl className="sheet-group flex flex-col px-4">
        {account && (
          <Row label="Banco" value={account.bankName || account.name} />
        )}
        {account && (
          <Row
            label="Tarjeta"
            value={
              account.cardLast4 ? `•••• ${account.cardLast4}` : account.name
            }
          />
        )}
        <Row label="Fecha" value={fullDate(tx.date)} />
        <Row label="Tipo" value={income ? "Ingreso" : "Gasto"} />
        <Row
          label="Estado"
          value={
            STATUS_LABEL[
              tx.status === "pending" &&
              (tx.recurringTemplateId || tx.installmentForecast)
                ? "committed"
                : tx.status
            ] ?? tx.status
          }
        />
        {tx.recurringTemplateId && (
          <Row
            label="Recurrencia"
            value={
              <span className="inline-flex items-center gap-1.5">
                <Repeat
                  className={cn(
                    "size-3.5",
                    recurringActive ? "text-primary" : "text-muted-foreground"
                  )}
                />
                {recurringActive ? "Activa" : "Pausada"}
              </span>
            }
          />
        )}
        {/* Hasta cuándo sigue cobrándose: se decide una vez y después se olvida, así que se
            muestra donde el movimiento se consulta. */}
        {tx.recurringTemplateId && (
          <Row
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
          <Row
            label="Cuotas"
            value={
              <Link
                href="/recurring#cuotas"
                className="inline-flex items-center gap-1.5 underline underline-offset-2"
              >
                <CreditCard className="size-3.5 text-primary" />
                Es la cuota de un plan
              </Link>
            }
          />
        )}
        {/* Esta compra se repartió en cuotas: por eso ya no cuenta como gasto (cada cuota lo hace en
            su mes). Sin el sello se vería como un movimiento interno sin explicación. */}
        {tx.installmentSourceCount && (
          <Row
            label="Cuotas"
            value={
              <Link
                href="/recurring#cuotas"
                className="inline-flex items-center gap-1.5 underline underline-offset-2"
              >
                <CreditCard className="size-3.5 text-primary" />
                Compra en {tx.installmentSourceCount} cuotas
              </Link>
            }
          />
        )}
      </dl>

      <div>
        <Label className="mb-2 block text-footnote">Categoría</Label>
        {visibleCategories.length === 0 ? (
          <p className="text-subheadline text-muted-foreground">
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
              <p className="mt-2 text-footnote text-muted-foreground">
                Cambiarla también recategoriza la recurrencia. Para dejarlo sin
                categoría, elimina antes la recurrencia.
              </p>
            )}
            {inInstallmentPlan && (
              <p className="mt-2 text-footnote text-muted-foreground">
                Cambiarla recategoriza el plan de cuotas completo: todas sus
                cuotas y la compra original.
              </p>
            )}
          </>
        )}
      </div>

      {/* La recurrencia que generó el movimiento se gestiona aquí, en filas: pausar en azul y
          eliminar aparte, en rojo y con confirmación. */}
      {tx.recurringTemplateId && (
        <ModalSection title="Recurrencia">
          <button
            type="button"
            onClick={toggleRecurring}
            disabled={saving}
            className={NAV_ROW}
          >
            {recurringActive ? (
              <PauseCircle className="size-5 shrink-0 text-primary" />
            ) : (
              <PlayCircle className="size-5 shrink-0 text-primary" />
            )}
            <span className="min-w-0 flex-1 text-primary">
              {recurringActive ? "Pausar recurrencia" : "Reanudar recurrencia"}
            </span>
          </button>
        </ModalSection>
      )}
      {/* Descubrimiento: crear la recurrente se queda a la vista, no escondido en un menú. Una
          compra ya repartida en cuotas no admite recurrente ni volver a pasarse a cuotas. En
          crédito, el movimiento es la COMPRA y se reparte en cuotas: el plan la reemplaza. En
          cualquier otra cuenta, el movimiento ES una cuota de una deuda que ya existe, y lo que
          corresponde es asignarlo — no crear nada. */}
      {!tx.recurringTemplateId && showConversions && (
        <ModalSection className="[--inset:3rem]">
          <button
            type="button"
            onClick={() => {
              haptic("light")
              setMakeRecurring(true)
            }}
            disabled={saving}
            className={NAV_ROW}
          >
            <Repeat className="size-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">Hacer recurrente</span>
            <ChevronRight aria-hidden className="disclosure" />
          </button>
          <button
            type="button"
            onClick={() => {
              haptic("light")
              if (isCreditCard) setMakeInstallments(true)
              else setAssignInstallment(true)
            }}
            disabled={saving}
            className={NAV_ROW}
          >
            <CreditCard className="size-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              {isCreditCard ? "Pasar a cuotas" : "Es una cuota"}
            </span>
            <ChevronRight aria-hidden className="disclosure" />
          </button>
        </ModalSection>
      )}
      {tx.recurringTemplateId && (
        <ModalDangerRow
          onClick={() => setConfirmDelete(true)}
          disabled={saving}
        >
          Eliminar recurrencia
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
            onClick={() => setConfirmDeleteTx(true)}
            disabled={saving}
          >
            {income ? "Eliminar ingreso" : "Eliminar gasto"}
          </ModalDangerRow>
        )}
      <ModalActions
        cancel={{ label: "Cerrar", onClick: onClose, disabled: saving }}
        primary={{
          label: saving
            ? "Guardando…"
            : changed
              ? "Guardar categoría"
              : "Guardado",
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

// Fila de una lista agrupada que abre otra cosa: ícono, texto y chevron; 44 px de alto.
const NAV_ROW =
  "press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-body disabled:opacity-50"

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-3 last:border-0">
      <dt className="text-subheadline text-muted-foreground">{label}</dt>
      <dd className="text-right text-subheadline font-medium">{value}</dd>
    </div>
  )
}

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

// Chip de categoría (exportado: lo reutiliza el triage). `disabled` mientras se persiste.
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
        "flex min-h-11 max-w-full shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-subheadline transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-transparent bg-(--glass-control) text-muted-foreground"
      )}
    >
      {children}
    </button>
  )
}
