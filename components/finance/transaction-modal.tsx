"use client"

import * as React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { es } from "date-fns/locale"
import { CalendarIcon, CircleDashed, CreditCard } from "lucide-react"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
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
import { useMoneyInput } from "@/hooks/use-money-input"
import { CategoryIcon } from "./category-icons"
import { formatCLP } from "@/lib/finance-format"
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
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = parseISODate(value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-11 w-full justify-start rounded-lg text-base font-normal"
        >
          <CalendarIcon className="size-4 text-muted-foreground" />
          {selected.toLocaleDateString("es-CL", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={es}
          selected={selected}
          defaultMonth={selected}
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
    <div className="flex flex-col gap-5 px-4 pb-6">
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
          <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 pb-1">
            <Chip
              active={categoryId === null}
              onClick={() => setCategoryId(null)}
            >
              <CircleDashed size={16} /> Sin categoría
            </Chip>
            {visibleCategories.map((c) => (
              <Chip
                key={c.id}
                active={c.id === categoryId}
                onClick={() => setCategoryId(c.id === categoryId ? null : c.id)}
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
        )}
      </div>

      <div className="flex gap-2">
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
      </div>
    </div>
  )
}

// Movimiento del banco: datos de solo lectura, pero SÍ se puede asignar/cambiar la categoría.
function ConnectedDetail({
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
  const income = tx.direction === "credit"
  const [categoryId, setCategoryId] = useState<string | null>(tx.categoryId)
  const [saving, setSaving] = useState(false)
  // Paso de aprendizaje tras guardar: pregunta el "porqué" (opcional) y ofrece propagar la
  // categoría a los N movimientos con la misma descripción. La categoría ya quedó persistida.
  const [learn, setLearn] = useState<{ sameTextCount: number } | null>(null)
  const changed = categoryId !== tx.categoryId
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
    <div className="flex flex-col gap-6 px-4 pb-6">
      <div className="flex flex-col items-center gap-1 pt-2 text-center">
        <div
          className={`tabular text-4xl font-bold ${income ? "text-success" : "text-foreground"}`}
        >
          {income ? "+" : "−"}
          {formatCLP(Math.abs(tx.amount))}
        </div>
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
        <Row label="Estado" value={STATUS_LABEL[tx.status] ?? tx.status} />
      </dl>

      <div>
        <Label className="mb-2 block text-xs">Categoría</Label>
        {visibleCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin categorías de {income ? "ingreso" : "gasto"}. Crea una para
            clasificar este movimiento.
          </p>
        ) : (
          <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 pb-1">
            <Chip
              active={categoryId === null}
              onClick={() => setCategoryId(null)}
            >
              <CircleDashed size={16} /> Sin categoría
            </Chip>
            {visibleCategories.map((c) => (
              <Chip
                key={c.id}
                active={c.id === categoryId}
                onClick={() => setCategoryId(c.id === categoryId ? null : c.id)}
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
        )}
      </div>

      <Button
        onClick={saveCategory}
        disabled={!changed || saving}
        className="h-12 rounded-full text-base"
      >
        {saving ? "Guardando…" : "Guardar categoría"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Movimiento del banco · solo se puede categorizar
      </p>
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
