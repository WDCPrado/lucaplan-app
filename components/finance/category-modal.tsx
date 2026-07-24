"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { haptic } from "@/lib/haptics"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
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
import type { CategoryDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

// Crear o editar categoría (global) + su límite del mes, siempre en modal. `category` ⇒ edición.
// SOLO categoría: los ingresos (fuentes) se editan aparte en IncomeModal — una categoría puede
// tener N ingresos. `lockedType` fija el tipo al crear desde un grupo (se oculta el selector y
// el título lo refleja); el selector solo aparece en creación libre.
export function CategoryModal({
  open,
  onOpenChange,
  period,
  category,
  lockedType,
  remainingToAllocate,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  period: { year: number; month: number }
  category?: CategoryDTO | null
  lockedType?: "income" | "expense" | null
  remainingToAllocate?: number | null
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
  const [confirmDelete, setConfirmDelete] = useState(false)

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
    setSaving(false)
    haptic("success")
    onOpenChange(false)
    router.refresh()
  }

  // Elimina la categoría: sus movimientos quedan sin categoría; los ingresos asignados se
  // eliminan. El backend rechaza (422 con mensaje) si recurrentes o planes de cuotas la usan.
  async function removeCategory() {
    if (!category || saving) return
    setSaving(true)
    haptic("heavy") // destructiva
    const res = await fetch(`/api/categories/${category.id}`, {
      method: "DELETE",
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return toast.error(data.error ?? "No se pudo eliminar la categoría")
    }
    haptic("success")
    toast.success("Categoría eliminada; sus movimientos quedaron sin categoría")
    onOpenChange(false)
    router.refresh()
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={
        isEdit
          ? "Editar categoría"
          : lockedType === "income"
            ? "Nueva categoría de ingreso"
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
            placeholder={type === "income" ? "Abonos" : "Compras"}
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
          {isEdit && (
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
              aria-label="Eliminar categoría"
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

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la categoría?</AlertDialogTitle>
            <AlertDialogDescription>
              Sus movimientos quedarán sin categoría (no se borran).
              {type === "income" &&
                " Los ingresos asignados a ella sí se eliminan."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={removeCategory}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ResponsiveModal>
  )
}
