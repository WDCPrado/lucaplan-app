"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { haptic } from "@/lib/haptics"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useMoneyInput } from "@/hooks/use-money-input"
import { cn } from "@/lib/utils"
import { formatCLP, monthName } from "@/lib/finance-format"
import { ProgressRing } from "./progress-ring"
import { CATEGORY_COLORS, CATEGORY_ICONS, CategoryIcon } from "./category-icons"
import { DayOfMonthPicker } from "./income-modal"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import type {
  AccountDTO,
  CategoryDTO,
  IncomeDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

// Cuentas que reciben ingresos: no de crédito (un abono a una tarjeta es un pago, no un ingreso).
const acceptsIncome = (a: AccountDTO) =>
  a.accountType !== "credit_card" && a.accountType !== "credit_line"

// Crear o editar categoría + lo que la define en el mes: límite (gasto) o su ingreso mensual
// (income: monto, cuenta y día — crear una categoría de ingreso ES asignarle un ingreso).
// `lockedType` fija el tipo al crear desde un grupo; el selector solo aparece en creación libre.
// `accounts`/`incomes` alimentan el bloque de ingreso; sin ellas (onboarding) el bloque se oculta.
export function CategoryModal({
  open,
  onOpenChange,
  period,
  category,
  lockedType,
  remainingToAllocate,
  accounts,
  incomes,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  period: { year: number; month: number }
  category?: CategoryDTO | null
  lockedType?: "income" | "expense" | null
  remainingToAllocate?: number | null
  accounts?: AccountDTO[]
  incomes?: IncomeDTO[]
}) {
  const router = useRouter()
  const isEdit = !!category
  const [name, setName] = useState(category?.name ?? "")
  const [type, setType] = useState<"income" | "expense">(
    (category?.type as "income" | "expense") ?? lockedType ?? "expense"
  )
  const [description, setDescription] = useState(category?.description ?? "")
  const limit = useMoneyInput("CLP", category?.limit ?? 0)
  const [icon, setIcon] = useState(category?.icon ?? "")
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0])
  const [saving, setSaving] = useState(false)

  // Fuente de ingreso vinculada a la categoría (edición).
  // ponytail: una fuente por categoría; si existieran varias se edita la primera.
  const source =
    (category && incomes?.find((i) => i.categoryId === category.id)) || null
  const destinations = (accounts ?? []).filter(acceptsIncome)
  const [accountId, setAccountId] = useState(source?.accountId ?? "")
  const account =
    destinations.find((a) => a.id === accountId) ?? destinations[0]
  const amount = useMoneyInput(
    (account?.currency as CurrencyCode) ?? "CLP",
    source?.amount ?? 0
  )
  const [day, setDay] = useState(source?.dayOfMonth ?? 1)

  const canSave = !!name.trim() && !saving

  // Color legacy fuera de la paleta: se muestra como swatch extra para no perderlo al editar.
  const palette = CATEGORY_COLORS.includes(color)
    ? CATEGORY_COLORS
    : [...CATEGORY_COLORS, color]

  // Restante en vivo: restante del mes + límite efectivo original − límite en pantalla.
  // Null (oculto) sin límite global definido o en categorías de ingreso.
  const liveRemaining =
    remainingToAllocate == null || type !== "expense"
      ? null
      : remainingToAllocate + (category?.limit ?? 0) - limit.value

  // Vista previa: gasto usa el uso real contra el límite en pantalla; ingreso, lleno si ya entró.
  const previewPct =
    type === "income"
      ? (category?.used ?? 0) > 0
        ? 100
        : 0
      : isEdit && limit.value > 0
        ? ((category?.used ?? 0) / limit.value) * 100
        : 0

  async function save() {
    if (!canSave) return
    setSaving(true)
    // 1) Categoría global (nombre/tipo/icono/color)
    const catRes = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: category?.id,
        name: name.trim(),
        type,
        icon,
        color,
        description: description.trim(),
      }),
    })
    if (!catRes.ok) {
      setSaving(false)
      haptic("error")
      toast.error("No se pudo guardar la categoría")
      return
    }
    const categoryId = category?.id ?? ((await catRes.json()).id as string)
    // 2) Límite del mes: solo para categorías de gasto (las de ingreso no tienen tope).
    if (type === "expense") {
      const limRes = await fetch("/api/category-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          year: period.year,
          month: period.month,
          limit: limit.value,
        }),
      })
      if (!limRes.ok) {
        setSaving(false)
        haptic("error")
        toast.error(
          "La categoría se guardó, pero el límite no. Vuelve a intentarlo."
        )
        return
      }
    }
    // 3) Ingreso mensual: con monto y cuenta se crea/actualiza la fuente (mismo nombre que la
    // categoría). Monto vacío no toca la fuente; quitarla es acción explícita aparte.
    if (type === "income" && amount.value > 0 && account) {
      const url = source
        ? `/api/incomes/${source.id}?year=${period.year}&month=${period.month}`
        : `/api/incomes?year=${period.year}&month=${period.month}`
      const incRes = await fetch(url, {
        method: source ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: account.id,
          categoryId,
          name: name.trim(),
          amount: amount.value,
          dayOfMonth: day,
          isActive: source?.isActive ?? true,
        }),
      })
      const data = await incRes.json().catch(() => ({}))
      if (!incRes.ok) {
        setSaving(false)
        haptic("error")
        toast.error(
          "La categoría se guardó, pero el ingreso no. Vuelve a intentarlo."
        )
        return
      }
      if (data.seed?.seeded)
        toast.success(`Presupuesto del mes: ${formatCLP(data.seed.total)}`)
    }
    setSaving(false)
    haptic("success")
    onOpenChange(false)
    router.refresh()
  }

  // Elimina el ingreso DESDE este mes (este y los próximos); los anteriores conservan su
  // historia — misma regla de vigencia que al editar. La categoría se conserva por eso mismo.
  async function removeSource() {
    if (!source || saving) return
    setSaving(true)
    haptic("heavy") // destructiva
    const res = await fetch(
      `/api/incomes/${source.id}?year=${period.year}&month=${period.month}`,
      { method: "DELETE" }
    )
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      toast.error("No se pudo eliminar el ingreso")
      return
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
      title={
        isEdit
          ? type === "income"
            ? "Editar ingreso"
            : "Editar categoría"
          : lockedType === "income"
            ? "Nuevo ingreso"
            : lockedType === "expense"
              ? "Nueva categoría de gasto"
              : "Nueva categoría"
      }
    >
      <div className="flex flex-col gap-5 px-4 pb-6">
        {/* Identidad: vista previa en vivo + nombre grande (mismo patrón que el resto de la app) */}
        <div className="flex items-center gap-4">
          <ProgressRing
            percent={previewPct}
            status={category?.status ?? "bueno"}
            size={64}
          >
            <CategoryIcon icon={icon} size={22} color={color} />
          </ProgressRing>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "income" ? "Sueldo" : "Compras"}
            aria-label="Nombre"
            className="h-12 flex-1 border-0 bg-transparent px-0 text-2xl font-bold shadow-none focus-visible:ring-0"
          />
        </div>

        {/* Tipo: solo en creación libre; fijado desde un grupo o en edición, el título ya lo dice. */}
        {!isEdit && !lockedType && (
          <div>
            <Label className="mb-1 block text-xs">Tipo</Label>
            <div className="flex gap-2">
              {(["expense", "income"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    "h-11 flex-1 rounded-full border text-sm font-medium transition-colors",
                    type === t
                      ? t === "income"
                        ? "border-success bg-success/10 text-success"
                        : "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground"
                  )}
                >
                  {t === "income" ? "Ingreso" : "Gasto"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Ingreso mensual: crear una categoría de ingreso es asignarle su ingreso */}
        {type === "income" &&
          accounts &&
          (destinations.length > 0 ? (
            <div className="flex flex-col gap-4 rounded-xl bg-secondary/50 p-4">
              <div>
                <Label className="mb-1 block text-xs">Monto mensual</Label>
                <div className="flex items-center gap-3">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-full bg-success text-lg text-success-foreground"
                    aria-hidden
                  >
                    +
                  </span>
                  <Input
                    inputMode="numeric"
                    placeholder="0"
                    value={amount.display}
                    onChange={(e) => amount.onChange(e.target.value)}
                    aria-label="Monto mensual del ingreso"
                    className="tabular h-11 flex-1 border-0 bg-transparent px-0 text-2xl font-bold text-success shadow-none focus-visible:ring-0"
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Lo que esperas recibir cada mes. Déjalo vacío si la categoría
                  solo agrupa abonos sueltos.
                </p>
              </div>
              {amount.value > 0 && (
                <>
                  <div>
                    <Label className="mb-1.5 block text-xs">
                      Cuenta donde entra
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {destinations.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            haptic("light")
                            setAccountId(a.id)
                          }}
                          className={cn(
                            "flex h-10 items-center rounded-full border px-4 text-sm whitespace-nowrap transition-colors",
                            a.id === account?.id
                              ? "border-primary bg-primary/10 text-primary"
                              : "text-muted-foreground"
                          )}
                        >
                          {a.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs">
                      Día en que llega
                    </Label>
                    <DayOfMonthPicker value={day} onChange={setDay} />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Si el mes no tiene ese día (ej. 31 en febrero), se usa el
                      último.
                    </p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="rounded-xl bg-secondary/50 p-4 text-xs text-muted-foreground">
              Necesitas una cuenta que reciba dinero (corriente, ahorro o
              billetera) para asignarle un monto mensual.
            </p>
          ))}

        {/* Presupuesto (solo gasto) */}
        {type === "expense" && (
          <div>
            <Label className="mb-1 block text-xs">
              Límite de {monthName(period.month)} (CLP)
            </Label>
            <Input
              inputMode="numeric"
              value={limit.display}
              onChange={(e) => limit.onChange(e.target.value)}
              placeholder="70.000"
              className="tabular h-11 text-base"
            />
            {liveRemaining !== null && (
              <p
                className={cn(
                  "mt-1 text-xs",
                  liveRemaining < 0
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              >
                {liveRemaining < 0
                  ? `Sobre-asignado por ${formatCLP(-liveRemaining)} del presupuesto de ${monthName(period.month)}`
                  : `Quedan ${formatCLP(liveRemaining)} por presupuestar en ${monthName(period.month)}`}
              </p>
            )}
          </div>
        )}

        {/* Apariencia: filas con scroll horizontal (mismo gesto que el resto de la app) */}
        <div>
          <Label className="mb-1.5 block text-xs">Icono</Label>
          <div className="-mx-4 grid scrollbar-none auto-cols-max grid-flow-col grid-rows-2 gap-2 overflow-x-auto px-4 pb-1">
            {CATEGORY_ICONS.map(({ name: n, Icon }) => (
              <button
                key={n}
                type="button"
                onClick={() => setIcon(n)}
                className={cn(
                  "grid size-10 place-items-center rounded-lg border transition-colors",
                  icon === n
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground"
                )}
                aria-label={n}
              >
                <Icon size={18} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label className="mb-1.5 block text-xs">Color</Label>
          <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 pb-1">
            {palette.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                className={cn(
                  "size-9 shrink-0 rounded-full border-2 transition-transform",
                  color === c
                    ? "scale-110 border-foreground"
                    : "border-transparent hover:scale-105"
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* Descripción IA (colapsable; abierta solo si ya tiene texto) */}
        <Collapsible defaultOpen={!!description}>
          <CollapsibleTrigger className="flex w-full items-center justify-between py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&[data-state=open]>svg]:rotate-180">
            Descripción para la IA (opcional)
            <ChevronDown className="size-4 transition-transform" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej: comida y mercadería para la casa (Jumbo, Líder, Unimarc)"
              rows={2}
              className="mt-1 resize-none text-base"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Ayuda a la IA a categorizar tus movimientos del banco.
            </p>
          </CollapsibleContent>
        </Collapsible>

        <div className="flex gap-2">
          {/* Eliminar el ingreso (solo edición con fuente): mismo patrón que tenía el modal viejo */}
          {type === "income" && source && (
            <Button
              variant="ghost"
              onClick={removeSource}
              disabled={saving}
              aria-label="Eliminar ingreso"
              className="h-12 rounded-full px-4 text-destructive hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
          <Button
            onClick={save}
            disabled={!canSave}
            className="h-12 flex-1 rounded-full text-base"
          >
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </ResponsiveModal>
  )
}
