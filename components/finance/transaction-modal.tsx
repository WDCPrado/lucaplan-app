"use client"

import * as React from "react"
import { useState } from "react"
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
import { useMoneyInput } from "@/hooks/use-money-input"
import { CategoryIcon } from "./category-icons"
import { formatCLP, formatMoney } from "@/lib/finance-format"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
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
        <div className="flex overflow-hidden rounded-full border">
          <button
            type="button"
            onClick={() => changeDirection("debit")}
            className={cn(
              "size-11 text-xl",
              direction === "debit" &&
                "bg-destructive text-destructive-foreground"
            )}
          >
            −
          </button>
          <button
            type="button"
            onClick={() => changeDirection("credit")}
            className={cn(
              "size-11 text-xl",
              direction === "credit" && "bg-success text-success-foreground"
            )}
          >
            +
          </button>
        </div>
        <Input
          inputMode="numeric"
          value={money.display}
          onChange={(e) => money.onChange(e.target.value)}
          className={cn(
            "tabular h-12 border-0 bg-transparent px-0 text-3xl font-bold shadow-none focus-visible:ring-0",
            direction === "debit" ? "text-destructive" : "text-success"
          )}
        />
      </div>

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
              {/* Sin categoría solo si NO es recurrente: la plantilla exige una, y quitarla aquí
                  la dejaría sin la suya. Se libera al eliminar la recurrencia. */}
              {!tx.recurringTemplateId && (
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
                  // Tocar la activa la deselecciona… salvo en un recurrente, que no puede quedarse
                  // sin categoría.
                  onClick={() =>
                    setCategoryId(
                      c.id === categoryId && !tx.recurringTemplateId
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
          </>
        )}
      </div>

      <ModalFooter>
        <Button
          variant="outline"
          onClick={remove}
          disabled={busy !== null}
          className="h-12 flex-1 rounded-full text-destructive hover:text-destructive"
        >
          {busy === "delete" ? "Borrando…" : "Eliminar"}
        </Button>
        <Button
          onClick={save}
          disabled={!canSave}
          className="h-12 flex-2 rounded-full text-base"
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
  const [learn, setLearn] = useState<{ sameTextCount: number } | null>(null)
  // Estado de la plantilla que generó este movimiento: llega resuelto en el DTO desde el servidor.
  // Optimista tras pausar/reanudar; `router.refresh()` trae el valor real.
  const [recurringActive, setRecurringActive] = useState(
    tx.recurringIsActive !== false
  )
  // Crear recurrente abre el formulario precargado: el usuario ajusta título, rango y periodicidad
  // antes de confirmar. Nunca se crea directo desde el movimiento.
  const [makeRecurring, setMakeRecurring] = useState(false)
  const [makeInstallments, setMakeInstallments] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const changed = categoryId !== tx.categoryId
  const isCreditCard = account?.accountType === "credit_card"
  // Solo categorías del mismo lado del movimiento (ingreso ↔ credit, gasto ↔ debit).
  const visibleCategories = savedFirst(
    categories.filter((c) => c.type === (income ? "income" : "expense")),
    tx.categoryId
  )

  async function saveCategory() {
    setSaving(true)
    const res = await fetch(`/api/transactions/${tx.id}/category`, {
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
    // Quitar categoría no aprende nada: cierre directo.
    if (!categoryId) {
      onClose()
      router.refresh()
      return
    }
    const data = await res.json().catch(() => ({}))
    setLearn({ sameTextCount: Number(data.sameTextCount) || 0 })
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
    toast.success(recurringActive ? "Recurrencia pausada" : "Recurrencia reanudada")
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
    toast.success("Recurrencia eliminada; los movimientos cobrados se conservan")
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
              tx.status === "pending" && tx.recurringTemplateId
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
              {/* Sin categoría solo si NO es recurrente: la plantilla exige una, y quitarla aquí
                  la dejaría sin la suya. Se libera al eliminar la recurrencia. */}
              {!tx.recurringTemplateId && (
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
                  // Tocar la activa la deselecciona… salvo en un recurrente, que no puede quedarse
                  // sin categoría.
                  onClick={() =>
                    setCategoryId(
                      c.id === categoryId && !tx.recurringTemplateId
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
          !income &&
          tx.categoryId &&
          !tx.installmentItemId && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  haptic("light")
                  setMakeRecurring(true)
                }}
                disabled={saving}
                className="h-12 shrink-0 rounded-full"
              >
                <Repeat className="size-4" />
                <span className="hidden sm:inline">Hacer recurrente</span>
              </Button>
              {/* Solo en crédito: el plan se dispara con el pago de ESA tarjeta, así que sobre otra
                  cuenta no se ejecutaría nunca. */}
              {isCreditCard && (
                <Button
                  variant="outline"
                  onClick={() => {
                    haptic("light")
                    setMakeInstallments(true)
                  }}
                  disabled={saving}
                  className="h-12 shrink-0 rounded-full"
                >
                  <CreditCard className="size-4" />
                  <span className="hidden sm:inline">Pasar a cuotas</span>
                </Button>
              )}
            </>
          )
        )}
        <Button
          onClick={saveCategory}
          disabled={!changed || saving}
          className="h-12 flex-1 rounded-full text-base"
        >
          {saving ? "Guardando…" : changed ? "Guardar categoría" : "Guardado"}
        </Button>
      </ModalFooter>

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
            <AlertDialogAction
              onClick={deleteRecurring}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* Cronograma precargado con esta compra. Al confirmarlo, la compra queda neutralizada (deja
          de contar como gasto) y el plan la reemplaza por una cuota al mes. */}
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
            categoryId: tx.categoryId,
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
            description: tx.description,
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
