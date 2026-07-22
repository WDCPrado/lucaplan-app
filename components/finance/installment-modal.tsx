"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { formatCLP } from "@/lib/finance-format"
import { CategoryIcon } from "./category-icons"
import { savedFirst } from "./transaction-modal"
import { DayOfMonthPicker } from "./income-modal"
import { schedule } from "@/arch/v1/domain/finance/installment.domain"
import type {
  AccountDTO,
  CategoryDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

/**
 * Valores con los que se abre el formulario al transformar una compra en cuotas. El plan nunca se
 * crea directo: el usuario revisa el cronograma antes, porque es él quien sabe en cuántas cuotas
 * compró y cuáles ya pagó.
 */
export type InstallmentPreset = {
  description?: string
  accountId?: string
  categoryId?: string | null
  totalAmount?: number
  sourceTransactionId?: string
}

// Reparto por defecto: el resto de la división queda en la última cuota, para que la suma sea
// exactamente el total y no falte ni sobre un peso.
function defaultAmounts(total: number, count: number): number[] {
  const base = Math.floor(total / count)
  return Array.from({ length: count }, (_, i) =>
    i === count - 1 ? total - base * (count - 1) : base
  )
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function InstallmentModal({
  open,
  onOpenChange,
  accounts,
  categories,
  kind,
  preset,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  kind: "card" | "loan"
  preset?: InstallmentPreset | null
}) {
  const router = useRouter()
  const today = new Date()

  // `card` se dispara con el pago de UNA TARJETA: sobre otra cuenta el plan no se ejecutaría nunca.
  // `loan` se carga a la cuenta que uno elija.
  const eligible =
    kind === "card"
      ? accounts.filter((a) => a.accountType === "credit_card")
      : accounts
  const expenseCategories = savedFirst(
    categories.filter((c) => c.type === "expense"),
    preset?.categoryId ?? null
  )

  const [description, setDescription] = useState(preset?.description ?? "")
  const [accountId, setAccountId] = useState(
    preset?.accountId ?? eligible[0]?.id ?? ""
  )
  const [categoryId, setCategoryId] = useState<string | null>(
    preset?.categoryId ?? expenseCategories[0]?.id ?? null
  )
  const [total, setTotal] = useState(preset?.totalAmount ?? 0)
  const [count, setCount] = useState(kind === "loan" ? 48 : 12)
  // Un crédito se registra casi siempre a mitad de camino: el banco dice "vas en la 5 de 49".
  const [startIndex, setStartIndex] = useState(1)
  const [day, setDay] = useState(today.getDate())
  const [startMonth, setStartMonth] = useState(monthValue(nextMonth(today)))
  const [amounts, setAmounts] = useState<number[] | null>(null)
  const [unpaid, setUnpaid] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  const account = eligible.find((a) => a.id === accountId) ?? eligible[0]
  const startDate = startOfMonth(startMonth)
  const dates = schedule(startDate, day, count, startIndex)
  // El total cubre solo las cuotas que este plan va a seguir; las anteriores ya se pagaron.
  const pendingCount = Math.max(1, count - startIndex + 1)
  const values = amounts ?? defaultAmounts(total, pendingCount)
  const sum = values.reduce((a, b) => a + b, 0)
  // El cronograma de un crédito es estimación: el monto real lo fija el correo de cada cuota, así
  // que exigir que cuadre rechazaría planes correctos.
  const mustMatchTotal = kind === "card"
  const sumOk = !mustMatchTotal || sum === total

  // Cuotas cuyo vencimiento ya pasó: se ofrecen premarcadas como pagadas, y el usuario desmarca
  // las que quedó debiendo. Las anteriores al desfase no entran: ya se dan por pagadas.
  const overdue = dates
    .map((d, i) => ({ index: i + 1, date: d }))
    .filter(({ index, date }) => index >= startIndex && date <= today)
  const paidIndexes = overdue
    .map((o) => o.index)
    .filter((i) => !unpaid.has(i))

  const canSave =
    !!description.trim() &&
    !!account &&
    !!categoryId &&
    total > 0 &&
    count >= 1 &&
    sumOk &&
    !saving

  // `values` está indexado por cuota PENDIENTE, no por índice del banco.
  function setAmountAt(pos: number, value: number) {
    const next = [...values]
    next[pos] = value
    setAmounts(next)
  }

  function setCountAndReset(n: number) {
    setCount(n)
    setAmounts(null) // el reparto se recalcula: mantener montos de otro N no tendría sentido
    setUnpaid(new Set())
  }

  async function save() {
    if (!canSave || !account || !categoryId) return
    setSaving(true)
    const res = await fetch("/api/installments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        accountId: account.id,
        categoryId,
        description: description.trim(),
        totalAmount: total,
        installmentsCount: count,
        startIndex,
        startDate: startDate.toISOString(),
        dayOfMonth: day,
        amounts: values,
        paidIndexes,
        sourceTransactionId: preset?.sourceTransactionId,
      }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return toast.error(data.error ?? "No se pudo crear el plan")
    }
    haptic("success")
    toast.success("Plan de cuotas creado")
    onOpenChange(false)
    router.refresh()
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={kind === "card" ? "Pasar a cuotas" : "Crédito en cuotas"}
    >
      {eligible.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          {kind === "card"
            ? "Las cuotas de tarjeta necesitan una cuenta de crédito."
            : "Necesitas una cuenta para registrar un crédito."}
        </div>
      ) : (
        <div className="flex flex-col px-4">
          {/* 1 · Qué se debe ------------------------------------------------- */}
          <Section title="Qué se debe">
            <Input
              placeholder={
                kind === "card" ? "Ej. Notebook" : "Ej. Crédito de consumo"
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label="Descripción"
              className="h-11 rounded-xl text-base"
            />
            {eligible.length > 1 && (
              <ChipRow>
                {eligible.map((a) => (
                  <Chip
                    key={a.id}
                    active={a.id === accountId}
                    onClick={() => setAccountId(a.id)}
                  >
                    {a.name}
                  </Chip>
                ))}
              </ChipRow>
            )}
            <ChipRow>
              {expenseCategories.map((c) => (
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
            </ChipRow>
          </Section>

          {/* 2 · Cuánto y en cuántas ----------------------------------------- */}
          <Section title="Cuánto y en cuántas">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-muted-foreground">
                $
              </span>
              <input
                inputMode="numeric"
                value={total ? total.toLocaleString("es-CL") : ""}
                onChange={(e) => {
                  setTotal(Number(e.target.value.replace(/\D/g, "")) || 0)
                  setAmounts(null)
                }}
                placeholder="0"
                aria-label="Monto total"
                className="tabular w-full bg-transparent text-3xl font-semibold outline-none"
              />
            </div>
            <span className="block text-xs text-muted-foreground">
              {kind === "card"
                ? "El precio de la compra, sin los intereses del banco."
                : "El saldo del crédito: lo que falta pagar, tal como lo muestra el banco. Ya incluye los intereses."}
            </span>
            <ChipRow>
              {(kind === "loan"
                ? [12, 24, 36, 48, 60]
                : [3, 6, 12, 18, 24, 36, 48]
              ).map((n) => (
                <Chip
                  key={n}
                  active={n === count}
                  onClick={() => setCountAndReset(n)}
                >
                  {n} cuotas
                </Chip>
              ))}
            </ChipRow>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                {kind === "loan" ? "Total del crédito" : "Total de cuotas"}
              </span>
              <input
                inputMode="numeric"
                value={count}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, "")) || 1
                  setCountAndReset(Math.min(n, 240))
                }}
                aria-label="Número total de cuotas"
                className="tabular h-10 w-20 rounded-xl border border-border bg-transparent px-3 text-right text-sm"
              />
            </label>
            {/* Un crédito rara vez se registra desde la cuota 1: el banco dice "vas en la 5 de 49",
                y respetar esa numeración es lo que hace que sus correos caigan en la cuota correcta. */}
            {kind === "loan" && (
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  Próxima cuota a pagar
                </span>
                <span className="flex items-center gap-1.5">
                  <input
                    inputMode="numeric"
                    value={startIndex}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(/\D/g, "")) || 1
                      setStartIndex(Math.min(Math.max(n, 1), count))
                      setAmounts(null)
                    }}
                    aria-label="Número de la próxima cuota"
                    className="tabular h-10 w-16 rounded-xl border border-border bg-transparent px-3 text-right text-sm"
                  />
                  <span className="text-muted-foreground">de {count}</span>
                </span>
              </label>
            )}
            {startIndex > 1 && (
              <span className="block text-xs text-muted-foreground">
                Las cuotas 1 a {startIndex - 1} se dan por pagadas: cuentan para
                el avance, pero no generan gasto en meses anteriores.
              </span>
            )}
          </Section>

          {/* 3 · Cuándo ------------------------------------------------------- */}
          <Section title="Cuándo se paga">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                {kind === "loan" ? `Mes de la cuota ${startIndex}` : "Primera cuota"}
              </span>
              <input
                type="month"
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                aria-label="Mes de la primera cuota"
                className="h-10 rounded-xl border border-border bg-transparent px-3 text-sm"
              />
            </label>
            <DayOfMonthPicker value={day} onChange={setDay} />
            <span className="block text-xs text-muted-foreground">
              {kind === "loan"
                ? `La cuota ${startIndex} vence el ${shortDate(dates[startIndex - 1])} y la última el ${shortDate(dates[dates.length - 1])}.`
                : `Termina el ${shortDate(dates[dates.length - 1])}.`}
            </span>
          </Section>

          {/* 4 · Cronograma --------------------------------------------------- */}
          <Section title="Cronograma" last>
            {overdue.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Las cuotas que ya vencieron vienen marcadas como pagadas.
                Desmarca las que quedaste debiendo.
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {/* Solo las cuotas que este plan va a seguir: las anteriores al desfase ya están
                  pagadas y listarlas sería ruido. El número mostrado es el DEL BANCO. */}
              {dates.slice(startIndex - 1).map((date, pos) => {
                const index = pos + startIndex
                const isOverdue = date <= today
                const paid = isOverdue && !unpaid.has(index)
                return (
                  <li
                    key={index}
                    className="flex items-center gap-3 rounded-xl px-1 py-1.5"
                  >
                    <span className="tabular w-6 shrink-0 text-xs text-muted-foreground">
                      {index}
                    </span>
                    <span className="w-24 shrink-0 text-sm text-muted-foreground">
                      {shortDate(date)}
                    </span>
                    <input
                      inputMode="numeric"
                      value={values[pos]?.toLocaleString("es-CL") ?? ""}
                      onChange={(e) =>
                        setAmountAt(
                          pos,
                          Number(e.target.value.replace(/\D/g, "")) || 0
                        )
                      }
                      aria-label={`Monto de la cuota ${index}`}
                      className="tabular min-w-0 flex-1 rounded-lg bg-secondary/40 px-2 py-1.5 text-right text-sm outline-none focus:bg-secondary"
                    />
                    {isOverdue ? (
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(unpaid)
                          if (paid) next.add(index)
                          else next.delete(index)
                          setUnpaid(next)
                        }}
                        aria-pressed={paid}
                        className={cn(
                          "shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors",
                          paid
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground"
                        )}
                      >
                        {paid ? "Pagada" : "Debiendo"}
                      </button>
                    ) : (
                      <span className="w-[68px] shrink-0" aria-hidden />
                    )}
                  </li>
                )
              })}
            </ul>
            {mustMatchTotal && sum !== total && (
              <p className="text-xs text-destructive">
                Las cuotas suman {formatCLP(sum)} y el total es{" "}
                {formatCLP(total)}. Ajusta {formatCLP(Math.abs(total - sum))}.
              </p>
            )}
          </Section>

          <ModalFooter>
            <Button
              onClick={save}
              disabled={!canSave}
              className="h-12 flex-1 rounded-full text-base"
            >
              {saving ? "Creando…" : "Crear plan"}
            </Button>
          </ModalFooter>
        </div>
      )}
    </ResponsiveModal>
  )
}

// Una compra en cuotas se factura el mes siguiente: proponer este mes haría que la primera cuota
// pareciera ya vencida el mismo día de la compra.
function nextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1)
}

function monthValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function startOfMonth(value: string): Date {
  const [y, m] = value.split("-").map(Number)
  return new Date(y, (m || 1) - 1, 1)
}

function Section({
  title,
  children,
  last,
}: {
  title: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 py-5",
        !last && "border-b border-border/60"
      )}
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 pb-1">
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
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}
