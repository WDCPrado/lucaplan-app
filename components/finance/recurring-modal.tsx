"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Pause, Play, Trash2, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { useMoneyInput } from "@/hooks/use-money-input"
import { CategoryIcon } from "./category-icons"
import { Chip, DatePicker } from "./transaction-modal"
import { DayOfMonthPicker } from "./income-modal"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import type {
  AccountDTO,
  CategoryDTO,
  RecurringDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

// Fecha de término escrita completa, para revisar el año de un vistazo.
function readableEnd(iso: string): string | null {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

const PERIODICITIES = [
  { value: "monthly", label: "Mensual" },
  { value: "biweekly", label: "Quincenal" },
  { value: "yearly", label: "Anual" },
] as const

// Modal de plantilla recurrente (crear/editar). El monto base no es el monto exacto del cargo: es
// el centro del rango ± tolerancia con el que se reconoce el cobro cuando llega por correo.
// Valores con los que se abre el formulario al crear desde un movimiento: la creación nunca es
// directa, el usuario revisa y confirma (el monto del cargo es solo el centro del rango).
export type RecurringPreset = {
  label?: string // nombre inicial editable (por defecto, la descripción del movimiento)
  accountId?: string
  categoryId?: string | null
  baseAmount?: number
  dayOfMonth?: number
  // Movimiento desde el que se abre el formulario: al guardar queda vinculado como la ejecución
  // de su período (así aparece marcado como recurrente y no se duplica el comprometido del mes).
  sourceTransactionId?: string
}

export function RecurringModal({
  open,
  onOpenChange,
  accounts,
  categories,
  template,
  preset,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  template?: RecurringDTO | null // null/undefined = crear
  preset?: RecurringPreset | null // precarga al crear desde un movimiento
}) {
  const router = useRouter()
  const [label, setLabel] = useState(
    template?.label ?? preset?.label ?? ""
  )
  const [accountId, setAccountId] = useState(
    template?.accountId ?? preset?.accountId ?? accounts[0]?.id ?? ""
  )
  // La categoría siempre viene del movimiento de origen (creación) o de la plantilla (edición):
  // no se elige aquí, es de solo lectura.
  const categoryId = template?.categoryId ?? preset?.categoryId ?? null
  const [tolerancePct, setTolerancePct] = useState(template?.tolerancePct ?? 10)
  const [periodicity, setPeriodicity] = useState<string>(
    template?.periodicity ?? "monthly"
  )
  const [day, setDay] = useState(template?.dayOfMonth ?? preset?.dayOfMonth ?? 1)
  // Fin de vigencia: vacío = indefinida (nunca termina), que es el caso normal.
  const [endDate, setEndDate] = useState(
    template?.endDate ? template.endDate.slice(0, 10) : ""
  )
  const [withEnd, setWithEnd] = useState(!!template?.endDate)
  const [saving, setSaving] = useState(false)

  const inheritedCategory = categories.find((c) => c.id === categoryId)
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
  const money = useMoneyInput(
    (account?.currency as CurrencyCode) ?? "CLP",
    template?.baseAmount ?? preset?.baseAmount ?? 0
  )
  const needsDay = periodicity !== "biweekly"
  const canSave =
    !!label.trim() &&
    !!account &&
    !!categoryId &&
    money.value > 0 &&
    (!needsDay || (day >= 1 && day <= 31)) &&
    !saving

  const min = Math.round(money.value * (1 - tolerancePct / 100))
  const max = Math.round(money.value * (1 + tolerancePct / 100))
  const fmt = (n: number) => n.toLocaleString("es-CL")

  async function save() {
    if (!canSave || !account || !categoryId) return
    setSaving(true)
    const res = await fetch(
      template ? `/api/recurring/${template.id}` : "/api/recurring",
      {
        method: template ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: account.id,
          categoryId,
          label: label.trim(),
          direction: "debit",
          baseAmount: money.value,
          tolerancePct,
          periodicity,
          dayOfMonth: needsDay ? day : null,
          startDate: template?.startDate ?? new Date().toISOString(),
          endDate: endDate || null,
          isActive: template?.isActive ?? true,
          sourceTransactionId: template ? undefined : preset?.sourceTransactionId,
        }),
      }
    )
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return toast.error(data.error ?? "No se pudo guardar la recurrente")
    }
    haptic("success")
    toast.success(template ? "Recurrente actualizada" : "Recurrente creada")
    onOpenChange(false)
    router.refresh()
  }

  // Cambio de estado de la plantilla. Cierra el modal como las demás acciones — el estado nuevo
  // se ve en la fila, que sí se refresca.
  async function patch(body: object, ok: string, fail: string) {
    if (!template || saving) return
    setSaving(true)
    const res = await fetch(`/api/recurring/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return toast.error(data.error ?? fail)
    }
    haptic("success")
    toast.success(ok)
    onOpenChange(false)
    router.refresh()
  }

  // "Ya lo pagué": confirma el comprometido del período sin esperar el aviso del banco.
  function togglePaid() {
    if (!template) return
    patch(
      { periodPaid: !template.currentPeriodPaid },
      template.currentPeriodPaid ? "Marca deshecha" : "Cobro marcado como pagado",
      "No se pudo marcar el cobro"
    )
  }

  // Pausar es lo excepcional: vive acá y no en la fila, donde su botón le comía el ancho al
  // nombre en móvil. Terminada no se reanuda: hay que correr su fecha de fin.
  function toggleActive() {
    if (!template) return
    patch(
      { isActive: !template.isActive },
      template.isActive ? "Recurrente pausada" : "Recurrente reanudada",
      "No se pudo cambiar el estado"
    )
  }

  async function remove() {
    if (!template || saving) return
    setSaving(true)
    const res = await fetch(`/api/recurring/${template.id}`, {
      method: "DELETE",
    })
    setSaving(false)
    if (!res.ok) {
      haptic("error")
      return toast.error("No se pudo eliminar la recurrente")
    }
    haptic("success")
    toast.success("Recurrente eliminada")
    onOpenChange(false)
    router.refresh()
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={template ? "Editar recurrente" : "Nueva recurrente"}
    >
      {accounts.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          Necesitas una cuenta para crear un gasto recurrente.
        </div>
      ) : (
        <div className="flex flex-col px-4">
          {/* El banco avisa cuando quiere, y hasta entonces el gasto sigue como comprometido y el
              presupuesto muestra plata que ya salió. Va arriba porque es el estado del período,
              no un campo del formulario. Solo se deshace lo marcado a mano: un cargo del banco es
              un hecho. */}
          {template && template.isActive && !template.hasEnded && (
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-secondary/50 px-3 py-2.5">
              <span className="min-w-0 flex-1 text-sm">
                {template.currentPeriodPaid
                  ? "El cobro de este período ya está registrado."
                  : "El cobro de este período todavía no llega."}
              </span>
              {(!template.currentPeriodPaid ||
                template.currentPeriodPaidManually) && (
                <Button
                  variant="outline"
                  onClick={togglePaid}
                  disabled={saving}
                  className="h-11 shrink-0 rounded-full text-sm"
                >
                  {template.currentPeriodPaid ? (
                    <>
                      <Undo2 className="size-4" />
                      Deshacer
                    </>
                  ) : (
                    <>
                      <Check className="size-4" />
                      Ya lo pagué
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* 1 · Qué se cobra ------------------------------------------------ */}
          <Section title="Qué se cobra">
            <Input
              placeholder="Ej. Arriendo depto"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              aria-label="Nombre"
              className="h-11 rounded-xl text-base"
            />
            <span className="block text-xs text-muted-foreground">
              Es solo el nombre para reconocerla aquí; cambiarlo no afecta la
              detección del cargo en el correo.
            </span>
            {/* La categoría la manda el movimiento, no la plantilla: si se pudiera editar en los
                dos lados habría dos verdades. Como una recurrente solo nace de un movimiento,
                la categoría siempre es heredada; se cambia recategorizando el movimiento. */}
            <div className="flex items-center gap-2 rounded-xl bg-secondary/50 px-3 py-2.5">
              <CategoryIcon
                icon={inheritedCategory?.icon ?? null}
                size={18}
                color={inheritedCategory?.color ?? undefined}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {inheritedCategory?.name ?? "Sin categoría"}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                Del movimiento
              </span>
            </div>
          </Section>

          {/* 2 · Cuánto ------------------------------------------------------ */}
          <Section title="Cuánto">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-muted-foreground">
                $
              </span>
              <Input
                inputMode="numeric"
                placeholder="0"
                value={money.display}
                onChange={(e) => money.onChange(e.target.value)}
                aria-label="Monto base"
                // md:text-3xl: el Input trae md:text-sm y en escritorio dejaba el monto en 14 px.
                className="tabular h-12 border-0 bg-transparent px-0 text-3xl font-bold shadow-none focus-visible:ring-0 md:text-3xl"
              />
            </div>

            {/* El rango ES el concepto de la recurrente: el cargo real varía mes a mes y aun así
                debe reconocerse. Por eso va en tamaño de dato, no en letra chica. */}
            <div className="rounded-xl bg-secondary/50 p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Reconoce cargos entre
                </span>
                <span className="text-xs font-medium text-muted-foreground tabular-nums">
                  ±{tolerancePct}%
                </span>
              </div>
              <div className="tabular flex items-baseline gap-2 text-lg font-semibold">
                <span>{fmt(min)}</span>
                <span className="text-muted-foreground">—</span>
                <span>{fmt(max)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                step={5}
                value={tolerancePct}
                onChange={(e) => setTolerancePct(Number(e.target.value))}
                className="mt-3 w-full accent-primary"
                aria-label="Tolerancia del monto"
              />
            </div>
          </Section>

          {/* 3 · Cuándo ------------------------------------------------------ */}
          <Section title="Cuándo" last>
            <ChipRow>
              {PERIODICITIES.map((p) => (
                <Chip
                  key={p.value}
                  active={p.value === periodicity}
                  onClick={() => setPeriodicity(p.value)}
                >
                  {p.label}
                </Chip>
              ))}
            </ChipRow>
            {needsDay && (
              <div className="space-y-1.5">
                <DayOfMonthPicker value={day} onChange={setDay} />
                <span className="block text-xs text-muted-foreground">
                  Si el mes no tiene ese día (ej. 31 en febrero), se usa el
                  último.
                </span>
              </div>
            )}
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-muted-foreground">
                Hasta cuándo
              </span>
              {withEnd ? (
                <div className="flex items-center gap-2">
                  <span className="flex-1">
                    <DatePicker
                      value={endDate}
                      onChange={setEndDate}
                      placeholder="Elegir fecha de término"
                      fromDate={(
                        template?.startDate ?? new Date().toISOString()
                      ).slice(0, 10)}
                    />
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setWithEnd(false)
                      setEndDate("")
                    }}
                    className="h-11 shrink-0 rounded-lg text-xs text-muted-foreground"
                  >
                    Sin término
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  // El campo se abre VACÍO a propósito: una fecha propuesta (p. ej. "+1 año") se
                  // acepta sin mirar el año y termina guardando una vigencia que nadie eligió.
                  onClick={() => setWithEnd(true)}
                  className="text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                >
                  No termina · poner fecha de término
                </button>
              )}
              {/* La fecha en palabras: el input muestra 25/08/2027 y el año se lee de reojo.
                  Escrito completo, un error de año salta a la vista antes de guardar. */}
              {endDate && (
                <span className="block text-xs text-muted-foreground">
                  {readableEnd(endDate)
                    ? `Se cobra hasta el ${readableEnd(endDate)}; después queda finalizada.`
                    : "El último cobro es el de esa fecha; después queda finalizada."}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-muted-foreground">
                Cuenta del cargo
              </span>
              <ChipRow>
                {accounts.map((a) => (
                  <Chip
                    key={a.id}
                    active={a.id === account?.id}
                    onClick={() => setAccountId(a.id)}
                  >
                    {a.name}
                  </Chip>
                ))}
              </ChipRow>
            </div>
          </Section>

          <ModalFooter>
            {template && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={saving}
                    className="size-12 shrink-0 rounded-full text-destructive hover:text-destructive"
                    aria-label="Eliminar recurrente"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      ¿Eliminar la recurrencia?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Se borra la plantilla y deja de cobrarse. Los movimientos
                      ya cobrados se conservan.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={remove}
                      variant="destructive"
                    >
                      Eliminar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {template && !template.hasEnded && (
              <Button
                variant="outline"
                size="icon"
                disabled={saving}
                onClick={toggleActive}
                aria-label={template.isActive ? "Pausar recurrente" : "Reanudar recurrente"}
                title={template.isActive ? "Pausar" : "Reanudar"}
                className="size-12 shrink-0 rounded-full"
              >
                {template.isActive ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
              </Button>
            )}
            <Button
              onClick={save}
              disabled={!canSave}
              className="h-12 flex-1 rounded-full text-base"
            >
              {saving ? "Guardando…" : template ? "Guardar" : "Crear recurrente"}
            </Button>
          </ModalFooter>
        </div>
      )}
    </ResponsiveModal>
  )
}

// Bloque temático del formulario. La separación por línea (no por tarjeta) evita el anidamiento
// de superficies dentro de un modal que ya es una tarjeta.
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

// Fila de chips con scroll horizontal que sangra hasta los bordes del modal.
function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 pb-1">
      {children}
    </div>
  )
}
