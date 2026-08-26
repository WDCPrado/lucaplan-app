"use client"

import * as React from "react"
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { es } from "date-fns/locale"
import {
  CalendarIcon,
  CircleDashed,
  CreditCard,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  Repeat,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { useMoneyInput } from "@/hooks/use-money-input"
import { CategoryIcon } from "./category-icons"
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
// Exportado: el triage de sin categoría reutiliza la misma línea de cuenta.
export function accountLabel(account: AccountDTO | undefined): string | null {
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
      <div className="flex items-baseline justify-between gap-3 text-xs">
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
  placeholder = "Elegir fecha",
  fromDate,
}: {
  value: string // "" = sin fecha elegida todavía
  onChange: (v: string) => void
  placeholder?: string
  fromDate?: string // YYYY-MM-DD: días anteriores deshabilitados
}) {
  const [open, setOpen] = useState(false)
  // Sin valor no hay día seleccionado: el calendario abre en el mes actual y el botón muestra
  // el placeholder, en vez de fingir una fecha que el usuario no eligió.
  const selected = value ? parseISODate(value) : undefined
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-11 w-full justify-start rounded-lg text-base font-normal"
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
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={es}
          selected={selected}
          defaultMonth={selected}
          disabled={fromDate ? { before: parseISODate(fromDate) } : undefined}
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
  const account = tx ? accounts.find((a) => a.id === tx.accountId) : undefined
  return (
    <ResponsiveModal
      open={tx !== null}
      onOpenChange={onOpenChange}
      title={tx?.editable ? "Editar movimiento" : "Movimiento del banco"}
    >
      {tx &&
        (tx.editable ? (
          <EditForm
            key={tx.id}
            tx={tx}
            account={account}
            categories={categories}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <ConnectedDetail
            key={tx.id}
            tx={tx}
            account={account}
            accounts={accounts}
            categories={categories}
            onClose={() => onOpenChange(false)}
          />
        ))}
    </ResponsiveModal>
  )
}

function EditForm({
  tx,
  account,
  categories,
  onClose,
}: {
  tx: TransactionDTO
  account: AccountDTO | undefined
  categories: CategoryDTO[]
  onClose: () => void
}) {
  const router = useRouter()
  const [description, setDescription] = useState(tx.description)
  const [direction, setDirection] = useState<"debit" | "credit">(
    tx.direction === "credit" ? "credit" : "debit"
  )
  const [categoryId, setCategoryId] = useState<string | null>(tx.categoryId)
  const [date, setDate] = useState(tx.date.slice(0, 10))
  const money = useMoneyInput(tx.currency as CurrencyCode, Math.abs(tx.amount))
  const [busy, setBusy] = useState<null | "save" | "delete">(null)
  // La cuota de un plan: su monto es un espejo del cronograma (se edita en el plan, que sincroniza
  // el movimiento) y su categoría es la del plan (cambiarla aquí recategoriza el plan completo).
  const isInstallment = !!tx.installmentItemId

  const canSave = money.value > 0 && description.trim() !== "" && busy === null

  // Categorías filtradas por el lado elegido (gasto/ingreso); al cambiar de lado se limpia si no calza.
  const visibleCategories = savedFirst(
    categories.filter(
      (c) => c.type === (direction === "credit" ? "income" : "expense")
    ),
    tx.categoryId
  )

  function changeDirection(d: "debit" | "credit") {
    setDirection(d)
    const t = d === "credit" ? "income" : "expense"
    if (categoryId && categories.find((c) => c.id === categoryId)?.type !== t)
      setCategoryId(null)
  }

  async function save() {
    if (!canSave) return
    setBusy("save")
    const res = await fetch(`/api/transactions/${tx.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: description.trim(),
        amount: money.value,
        direction,
        categoryId,
        date,
      }),
    })
    setBusy(null)
    haptic(res.ok ? "success" : "error")
    if (res.ok) {
      onClose()
      router.refresh()
    }
  }

  async function remove() {
    setBusy("delete")
    haptic("heavy") // acción destructiva
    const res = await fetch(`/api/transactions/${tx.id}`, { method: "DELETE" })
    setBusy(null)
    if (res.ok) {
      onClose()
      router.refresh()
    } else {
      haptic("error")
    }
  }

  return (
    <div className="flex flex-col gap-5 px-4">
      <Input
        placeholder="Descripción"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="h-12 border-0 bg-transparent px-0 text-2xl font-bold shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center gap-3">
        <DirectionToggle
          value={direction}
          onChange={changeDirection}
          disabled={isInstallment}
        />
        <Input
          inputMode="numeric"
          value={money.display}
          onChange={(e) => money.onChange(e.target.value)}
          disabled={isInstallment}
          className={cn(
            // Misma regla que las filas del dashboard: ingreso verde, gasto neutro. Rojo queda
            // reservado para estados (vencido, error), no para "es un gasto".
            "tabular h-12 border-0 bg-transparent px-0 text-3xl font-bold shadow-none focus-visible:ring-0",
            direction === "debit" ? "text-foreground" : "text-success"
          )}
        />
      </div>
      {isInstallment && (
        <p className="-mt-3 text-xs text-muted-foreground">
          El monto de una cuota se edita en su plan de cuotas.
        </p>
      )}

      <CategoryBudgetLine
        category={categories.find((c) => c.id === categoryId)}
      />

      {accountLabel(account) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CreditCard className="size-4 shrink-0" />
          <span className="truncate">{accountLabel(account)}</span>
        </div>
      )}

      <div>
        <Label className="mb-1 block text-xs">Fecha</Label>
        <DatePicker value={date} onChange={setDate} />
      </div>

      <div>
        <Label className="mb-1 block text-xs">Categoría</Label>
        {visibleCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin categorías de {direction === "credit" ? "ingreso" : "gasto"}.
          </p>
        ) : (
          <>
            <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 pb-1">
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
              <p className="mt-2 text-xs text-muted-foreground">
                Cambiarla también recategoriza la recurrencia. Para dejarlo sin
                categoría, elimina antes la recurrencia.
              </p>
            )}
            {isInstallment && (
              <p className="mt-2 text-xs text-muted-foreground">
                Cambiarla recategoriza el plan de cuotas completo: todas sus
                cuotas y la compra original.
              </p>
            )}
          </>
        )}
      </div>

      <ModalFooter>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              disabled={busy !== null}
              className="size-12 shrink-0 rounded-full text-destructive hover:text-destructive"
              aria-label="Eliminar movimiento"
            >
              <Trash2 className="size-4" />
            </Button>
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
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={remove} variant="destructive">
                {busy === "delete" ? "Borrando…" : "Eliminar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button
          onClick={save}
          disabled={!canSave}
          className="h-12 flex-1 rounded-full text-base"
        >
          {busy === "save" ? "Guardando…" : "Guardar"}
        </Button>
      </ModalFooter>
    </div>
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
      <div className="flex flex-col gap-5 px-4 pb-6">
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
    <div className="flex flex-col gap-6 px-4">
      <div className="flex flex-col items-center gap-1 pt-2 text-center">
        <div
          className={`tabular text-4xl font-bold ${income ? "text-success" : "text-foreground"}`}
        >
          {income ? "+" : "−"}
          {tx.currency === "CLP"
            ? formatCLP(Math.abs(tx.amount))
            : formatMoney(Math.abs(tx.amount), tx.currency as CurrencyCode)}
        </div>
        {tx.amountClp != null && (
          <div className="tabular text-sm text-muted-foreground">
            ≈ {formatCLP(Math.abs(tx.amountClp))} · dólar del día
          </div>
        )}
        <div className="text-sm text-balance text-muted-foreground">
          {tx.description}
        </div>
      </div>

      <CategoryBudgetLine
        category={categories.find((c) => c.id === categoryId)}
      />

      <dl className="flex flex-col">
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
                href="/installments"
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
                href="/installments"
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
        <Label className="mb-2 block text-xs">Categoría</Label>
        {visibleCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin categorías de {income ? "ingreso" : "gasto"}. Crea una para
            clasificar este movimiento.
          </p>
        ) : (
          <>
            <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 pb-1">
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
              <p className="mt-2 text-xs text-muted-foreground">
                Cambiarla también recategoriza la recurrencia. Para dejarlo sin
                categoría, elimina antes la recurrencia.
              </p>
            )}
            {inInstallmentPlan && (
              <p className="mt-2 text-xs text-muted-foreground">
                Cambiarla recategoriza el plan de cuotas completo: todas sus
                cuotas y la compra original.
              </p>
            )}
          </>
        )}
      </div>

      <ModalFooter>
        {tx.recurringTemplateId ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                disabled={saving}
                aria-label="Acciones de la recurrencia"
                className="size-12 shrink-0 rounded-full"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onSelect={toggleRecurring}>
                {recurringActive ? (
                  <>
                    <PauseCircle className="size-4" /> Pausar recurrencia
                  </>
                ) : (
                  <>
                    <PlayCircle className="size-4" /> Reanudar recurrencia
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-4" /> Eliminar recurrencia
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          // Descubrimiento: crear la recurrente se queda a la vista, no escondido en el menú.
          // Una compra ya repartida en cuotas no admite recurrente ni volver a pasarse a cuotas.
          // Los labels van SIEMPRE visibles (un círculo con icono no explica nada); en móvil no
          // caben junto a Guardar, así que el footer se apila en dos filas (flex-wrap).
          showConversions && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  haptic("light")
                  setMakeRecurring(true)
                }}
                disabled={saving}
                className="h-12 flex-1 rounded-full sm:flex-initial"
              >
                <Repeat className="size-4" />
                Hacer recurrente
              </Button>
              {/* En crédito, el movimiento es la COMPRA y se reparte en cuotas: el plan la
                  reemplaza. En cualquier otra cuenta, el movimiento ES una cuota de una deuda que
                  ya existe, y lo que corresponde es asignarlo — no crear nada. */}
              {isCreditCard ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    haptic("light")
                    setMakeInstallments(true)
                  }}
                  disabled={saving}
                  className="h-12 flex-1 rounded-full sm:flex-initial"
                >
                  <CreditCard className="size-4" />
                  Pasar a cuotas
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    haptic("light")
                    setAssignInstallment(true)
                  }}
                  disabled={saving}
                  className="h-12 flex-1 rounded-full sm:flex-initial"
                >
                  <CreditCard className="size-4" />
                  Es una cuota
                </Button>
              )}
            </>
          )
        )}
        {/* Eliminar: los ingresos (los abona el usuario) y los gastos SIN categoría — ruido del
            banco que nadie clasificó. Se mira la categoría GUARDADA, no la elegida en pantalla.
            Nunca los generados por recurrencia o plan de cuotas: se gestionan en su origen. */}
        {(income || !tx.categoryId) &&
          !tx.recurringTemplateId &&
          !inInstallmentPlan &&
          !tx.installmentForecast && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => setConfirmDeleteTx(true)}
              disabled={saving}
              aria-label={income ? "Eliminar ingreso" : "Eliminar gasto"}
              className="size-12 shrink-0 rounded-full text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        <Button
          onClick={saveCategory}
          disabled={!changed || saving}
          className={cn(
            "h-12 rounded-full text-base",
            // Con acciones de conversión, Guardar baja a su propia fila en móvil (basis-full
            // fuerza el salto de línea del flex-wrap del footer).
            showConversions ? "grow basis-full sm:basis-0" : "flex-1"
          )}
        >
          {saving ? "Guardando…" : changed ? "Guardar categoría" : "Guardado"}
        </Button>
      </ModalFooter>

      <AlertDialog open={confirmDeleteTx} onOpenChange={setConfirmDeleteTx}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteCopy(income).title}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCopy(income).description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={removeTx} variant="destructive">
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
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deleteRecurring} variant="destructive">
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
          onOpenChange={(o) => {
            setMakeLoan(o)
            if (!o) onClose()
          }}
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
          onOpenChange={(o) => {
            setMakeInstallments(o)
            if (!o) onClose()
          }}
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
          onOpenChange={(o) => {
            setMakeRecurring(o)
            if (!o) onClose()
          }}
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-3 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
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
  return (
    <div className="flex overflow-hidden rounded-full border">
      {(["debit", "credit"] as const).map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => {
            haptic("light")
            onChange(d)
          }}
          disabled={disabled}
          aria-pressed={value === d}
          aria-label={d === "debit" ? "Gasto" : "Ingreso"}
          className={cn(
            "size-11 text-xl disabled:opacity-50",
            value === d &&
              (d === "debit"
                ? "bg-destructive text-destructive-foreground"
                : "bg-success text-success-foreground")
          )}
        >
          {d === "debit" ? "−" : "+"}
        </button>
      ))}
    </div>
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
      className={cn(
        "flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm whitespace-nowrap disabled:opacity-50",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "text-muted-foreground"
      )}
    >
      {children}
    </button>
  )
}
