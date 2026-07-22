"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarIcon, Trash2 } from "lucide-react"
import { es } from "date-fns/locale"
import { toast } from "sonner"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { useMoneyInput } from "@/hooks/use-money-input"
import { CategoryIcon } from "./category-icons"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import type {
  AccountDTO,
  CategoryDTO,
  IncomeDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

// Cuentas que reciben ingresos: no de crédito (un abono a una tarjeta es un pago, no un ingreso).
const acceptsIncome = (a: AccountDTO) =>
  a.accountType !== "credit_card" && a.accountType !== "credit_line"

// Modal de fuente de ingreso (crear/editar). El monto se ingresa en la moneda de la cuenta destino.
// Al guardar, el backend siembra el límite global del mes si aún no está definido.
export function IncomeModal({
  open,
  onOpenChange,
  accounts,
  categories,
  income,
  period,
  onCreateCategory,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  income?: IncomeDTO | null // null/undefined = crear; objeto = editar
  period: { year: number; month: number }
  onCreateCategory: () => void
}) {
  const router = useRouter()
  const destinations = accounts.filter(acceptsIncome)
  const incomeCategories = categories.filter((c) => c.type === "income")

  const [name, setName] = useState(income?.name ?? "")
  const [accountId, setAccountId] = useState(
    income?.accountId ?? destinations[0]?.id ?? ""
  )
  const [categoryId, setCategoryId] = useState<string | null>(
    income?.categoryId ?? incomeCategories[0]?.id ?? null
  )
  const [day, setDay] = useState(income?.dayOfMonth ?? 1)
  const [saving, setSaving] = useState(false)

  const account = destinations.find((a) => a.id === accountId) ?? destinations[0]
  const money = useMoneyInput(
    (account?.currency as CurrencyCode) ?? "CLP",
    income?.amount ?? 0
  )
  const canSave =
    !!name.trim() &&
    !!account &&
    !!categoryId &&
    money.value > 0 &&
    day >= 1 &&
    day <= 31 &&
    !saving

  async function save() {
    if (!canSave || !account || !categoryId) return
    setSaving(true)
    const url = income
      ? `/api/incomes/${income.id}?year=${period.year}&month=${period.month}`
      : `/api/incomes?year=${period.year}&month=${period.month}`
    const res = await fetch(url, {
      method: income ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        categoryId,
        name: name.trim(),
        amount: money.value,
        dayOfMonth: day,
        isActive: income?.isActive ?? true,
      }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return toast.error(data.error ?? "No se pudo guardar el ingreso")
    }
    haptic("success")
    if (data.seed?.seeded)
      toast.success(
        `Presupuesto del mes: ${data.seed.total.toLocaleString("es-CL")}`
      )
    else toast.success(income ? "Ingreso actualizado" : "Ingreso agregado")
    onOpenChange(false)
    router.refresh()
  }

  async function remove() {
    if (!income || saving) return
    setSaving(true)
    const res = await fetch(`/api/incomes/${income.id}`, { method: "DELETE" })
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return toast.error("No se pudo eliminar el ingreso")
    }
    haptic("success")
    toast.success("Ingreso eliminado")
    onOpenChange(false)
    router.refresh()
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={income ? "Editar ingreso" : "Nuevo ingreso"}
    >
      {destinations.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          Necesitas una cuenta que reciba dinero (corriente, ahorro o billetera)
          para registrar un ingreso.
        </div>
      ) : (
        <div className="flex flex-col gap-5 px-4 pb-6">
          <Input
            placeholder="Nombre (ej. Sueldo)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-12 border-0 bg-transparent px-0 text-2xl font-bold shadow-none focus-visible:ring-0"
          />

          <div className="flex items-center gap-3">
            <span
              className="grid size-11 shrink-0 place-items-center rounded-full bg-success text-xl text-success-foreground"
              aria-hidden
            >
              +
            </span>
            <Input
              inputMode="numeric"
              placeholder="0"
              value={money.display}
              onChange={(e) => money.onChange(e.target.value)}
              aria-label="Monto del ingreso"
              className="tabular h-12 border-0 bg-transparent px-0 text-3xl font-bold text-success shadow-none focus-visible:ring-0"
            />
          </div>

          <Field label="Cuenta donde entra">
            <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 pb-1">
              {destinations.map((a) => (
                <Chip
                  key={a.id}
                  active={a.id === account?.id}
                  onClick={() => setAccountId(a.id)}
                >
                  {a.name}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Categoría de ingreso">
            <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 pb-1">
              {incomeCategories.map((c) => (
                <Chip
                  key={c.id}
                  active={c.id === categoryId}
                  onClick={() => setCategoryId(c.id)}
                >
                  <CategoryIcon
                    icon={c.icon}
                    size={16}
                    color={c.color ?? undefined}
                  />{" "}
                  {c.name}
                </Chip>
              ))}
              <Chip active={false} onClick={onCreateCategory}>
                ＋ Crear
              </Chip>
            </div>
          </Field>

          <Field label="Día de ingreso del mes">
            <DayOfMonthPicker value={day} onChange={setDay} />
            <span className="block text-xs text-muted-foreground">
              Si el mes no tiene ese día (ej. 31 en febrero), se usa el último.
            </span>
          </Field>

          <div className="flex gap-2">
            {income && (
              <Button
                variant="ghost"
                onClick={remove}
                disabled={saving}
                className="h-12 rounded-full px-4 text-destructive hover:text-destructive"
                aria-label="Eliminar ingreso"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
            <Button
              onClick={save}
              disabled={!canSave}
              className="h-12 flex-1 rounded-full text-base"
            >
              {saving ? "Guardando…" : income ? "Guardar" : "Agregar ingreso"}
            </Button>
          </div>
        </div>
      )}
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
}: {
  value: number
  onChange: (day: number) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-11 w-full justify-start rounded-lg text-base font-normal"
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

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic("light")
        onClick()
      }}
      className={cn(
        "flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm whitespace-nowrap",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "text-muted-foreground"
      )}
    >
      {children}
    </button>
  )
}
