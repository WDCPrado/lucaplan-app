"use client"

import { useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowUpRight, Check, ChevronRight, Loader } from "lucide-react"
import { toast } from "sonner"

import {
  ModalDangerRow,
  ModalSection,
  ResponsiveModal,
} from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
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
import { haptic } from "@/lib/haptics"
import { RECURRING_URL_MAX, linkHost, recurringUrlSchema } from "@/lib/schemas/recurring-url"
import { useMoneyInput } from "@/hooks/use-money-input"
import { CategoryIcon } from "./category-icons"
import { DatePicker } from "./transaction-modal"
import { Segmented } from "./segmented"
import { DayOfMonthPicker } from "./income-modal"
import {
  RecurringLinkPicker,
  type CandidateFilters,
} from "./recurring-link-picker"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import type {
  AccountDTO,
  CategoryDTO,
  RecurringDTO,
  TransactionDTO,
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
]

// Qué escritura está en curso: la acción tocada muestra su spinner y todas quedan deshabilitadas.
type Busy = "save" | "paid" | "pick" | "toggle" | "undo" | "delete" | null

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
  onSaved,
  accounts,
  categories,
  template,
  preset,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved?: () => void
  accounts: AccountDTO[]
  categories: CategoryDTO[]
  template?: RecurringDTO | null // null/undefined = crear
  preset?: RecurringPreset | null // precarga al crear desde un movimiento
}) {
  const router = useRouter()
  // Id por instancia: el botón del pie envía este formulario con `form=`, y un modal anidado
  // puede montar otro igual.
  const formId = `recurring-form-${useId()}`
  const [label, setLabel] = useState(template?.label ?? preset?.label ?? "")
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
  const [day, setDay] = useState(
    template?.dayOfMonth ?? preset?.dayOfMonth ?? 1
  )
  // Fin de vigencia: vacío = indefinida (nunca termina), que es el caso normal.
  const [endDate, setEndDate] = useState(
    template?.endDate ? template.endDate.slice(0, 10) : ""
  )
  const [withEnd, setWithEnd] = useState(!!template?.endDate)
  // Enlace al portal donde se paga (opcional): se escribe libre y se normaliza al guardar.
  const [url, setUrl] = useState(template?.url ?? "")
  const [urlError, setUrlError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const saving = busy !== null
  // Selector de un movimiento existente como cobro del período. null = cargando.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [candidates, setCandidates] = useState<
    TransactionDTO[] | null | "error"
  >(null)
  const [filters, setFilters] = useState<CandidateFilters>({
    q: "",
    days: 10,
  })
  // Cada carga lleva un número: si cambia un filtro o se reabre la lista antes de que llegue la
  // anterior, la vieja no pisa a la nueva.
  const reqRef = useRef(0)
  const typingRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const inheritedCategory = categories.find((c) => c.id === categoryId)
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
  const money = useMoneyInput(
    (account?.currency as CurrencyCode) ?? "CLP",
    template?.baseAmount ?? preset?.baseAmount ?? 0
  )
  const needsDay = periodicity !== "biweekly"
  // Editar sin cambios no guarda nada: el check queda gris, como en los movimientos.
  const dirty =
    !template ||
    label.trim() !== template.label ||
    accountId !== template.accountId ||
    money.value !== template.baseAmount ||
    tolerancePct !== template.tolerancePct ||
    periodicity !== template.periodicity ||
    (needsDay && day !== (template.dayOfMonth ?? 1)) ||
    (endDate || null) !== (template.endDate ? template.endDate.slice(0, 10) : null) ||
    url.trim() !== (template.url ?? "")
  const canSave =
    dirty &&
    !!label.trim() &&
    !!account &&
    !!categoryId &&
    money.value > 0 &&
    (!needsDay || (day >= 1 && day <= 31)) &&
    !saving

  const min = Math.round(money.value * (1 - tolerancePct / 100))
  const max = Math.round(money.value * (1 + tolerancePct / 100))
  const fmt = (n: number) => n.toLocaleString("es-CL")

  // Valida el enlace con el esquema compartido; devuelve el valor normalizado o undefined si falla.
  function parseUrl(): string | null | undefined {
    const parsed = recurringUrlSchema.safeParse(url)
    if (parsed.success) return parsed.data
    setUrlError(parsed.error.issues[0]?.message ?? "Enlace no válido")
    return undefined
  }

  async function save() {
    if (!canSave || !account || !categoryId) return
    const nextUrl = parseUrl()
    if (nextUrl === undefined) {
      haptic("error")
      document.getElementById("recurring-url")?.focus()
      return
    }
    // El enlace va solo si cambió (al crear, solo si se escribió).
    const urlChanged = nextUrl !== (template?.url ?? null)
    setBusy("save")
    try {
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
            sourceTransactionId: template
              ? undefined
              : preset?.sourceTransactionId,
            url: urlChanged ? nextUrl : undefined,
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      setBusy(null)
      if (!res.ok) {
        haptic("error")
        return toast.error(data.error ?? "No se pudo guardar la recurrente")
      }
      haptic("success")
      toast.success(template ? "Recurrente actualizada" : "Recurrente creada")
      onOpenChange(false)
      onSaved?.()
      router.refresh()
    } catch {
      haptic("error")
      toast.error("No se pudo guardar la recurrente")
    } finally {
      setBusy(null)
    }
  }

  // Cambio de estado de la plantilla. Cierra el modal como las demás acciones — el estado nuevo
  // se ve en la fila, que sí se refresca.
  async function patch(
    kind: Exclude<Busy, "save" | "delete" | null>,
    body: object,
    ok: string,
    fail: string
  ) {
    if (!template || saving) return
    setBusy(kind)
    try {
      const res = await fetch(`/api/recurring/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      setBusy(null)
      if (!res.ok) {
        haptic("error")
        return toast.error(data.error ?? fail)
      }
      haptic("success")
      toast.success(ok)
      setPickerOpen(false)
      onOpenChange(false)
      router.refresh()
    } catch {
      haptic("error")
      toast.error(fail)
    } finally {
      setBusy(null)
    }
  }

  // "Ya lo pagué": confirma el comprometido del período sin esperar el aviso del banco. Cuando el
  // cargo real llegue por correo, reemplaza esta marca con su monto y su fecha.
  function markPaid() {
    patch(
      "paid",
      { periodPaid: true },
      "Cobro marcado como pagado",
      "No se pudo marcar el cobro"
    )
  }

  // Deshace el "Ya lo pagué". Solo lo marcado a mano: un cargo del banco es un hecho.
  function undoPaid() {
    patch(
      "undo",
      { periodPaid: false },
      "Marca deshecha",
      "No se pudo deshacer la marca"
    )
  }

  // El cargo llegó con otra fecha y no se enganchó solo: se elige a mano entre los gastos sueltos.
  // Se carga al abrir y en cada cambio de filtro, desde el evento, sin efecto.
  async function loadCandidates(f: CandidateFilters) {
    if (!template) return
    const id = ++reqRef.current
    setCandidates(null)
    const params = new URLSearchParams({ days: String(f.days) })
    if (f.q.trim()) params.set("q", f.q.trim())
    try {
      const res = await fetch(
        `/api/recurring/${template.id}/candidates?${params}`
      )
      if (!res.ok) throw new Error()
      const data: { items: TransactionDTO[] } = await res.json()
      if (id !== reqRef.current) return
      setCandidates(data.items)
    } catch {
      if (id !== reqRef.current) return
      setCandidates("error")
    }
  }

  function openPicker() {
    setPickerOpen(true)
    loadCandidates(filters)
  }

  // El texto y los días escritos esperan 300 ms a que se deje de escribir, como el buscador de
  // movimientos; los chips recargan al tiro. Cualquier cambio cancela la espera pendiente.
  function changeFilters(next: CandidateFilters, debounce = false) {
    const typing = debounce || next.q !== filters.q
    setFilters(next)
    clearTimeout(typingRef.current)
    if (typing) typingRef.current = setTimeout(() => loadCandidates(next), 300)
    else loadCandidates(next)
  }

  // En error, patch no cierra nada: la lista sigue abierta para elegir otro.
  function pickTransaction(transactionId: string) {
    patch(
      "pick",
      { paidWithTransactionId: transactionId },
      "Cobro vinculado al movimiento",
      "No se pudo vincular el movimiento"
    )
  }

  // Pausar es lo excepcional: vive acá y no en la fila, donde su botón le comía el ancho al
  // nombre en móvil. Terminada no se reanuda: hay que correr su fecha de fin.
  function toggleActive() {
    if (!template) return
    patch(
      "toggle",
      { isActive: !template.isActive },
      template.isActive ? "Recurrente pausada" : "Recurrente reanudada",
      "No se pudo cambiar el estado"
    )
  }

  async function remove() {
    if (!template || saving) return
    setBusy("delete")
    try {
      const res = await fetch(`/api/recurring/${template.id}`, {
        method: "DELETE",
      })
      setBusy(null)
      if (!res.ok) {
        haptic("error")
        return toast.error("No se pudo eliminar la recurrente")
      }
      haptic("success")
      toast.success("Recurrente eliminada")
      onOpenChange(false)
      router.refresh()
    } catch {
      haptic("error")
      toast.error("No se pudo eliminar la recurrente")
    } finally {
      setBusy(null)
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={template ? "Editar recurrente" : "Nueva recurrente"}
      cancel={
        accounts.length === 0
          ? undefined
          : {
              label: "Cancelar",
              disabled: saving,
              onClick: () => onOpenChange(false),
            }
      }
      primary={
        accounts.length === 0
          ? undefined
          : {
              label: template ? "Guardar" : "Crear recurrente",
              form: formId,
              busy: busy === "save",
              disabled: !canSave,
            }
      }
    >
      {accounts.length === 0 ? (
        <div className="px-4 py-10 text-center text-subheadline text-muted-foreground">
          Necesitas una cuenta para crear un gasto recurrente.
        </div>
      ) : (
        <div className="flex flex-col gap-7 px-5 pt-2">
          {/* Estado del cobro del período: va arriba porque es el estado, no un campo. Elegir el
              movimiento a mano cubre el cargo que llegó con otra fecha y no se enganchó solo. */}
          {template && template.isActive && !template.hasEnded && (
            <ModalSection>
              <p className="flex min-h-11 items-center px-4 py-2.5 text-subheadline">
                {template.currentPeriodPaid
                  ? "El cobro de este período ya está registrado."
                  : "El cobro de este período todavía no llega."}
              </p>
              {!template.currentPeriodPaid && (
                <button
                  type="button"
                  onClick={markPaid}
                  disabled={saving}
                  aria-busy={busy === "paid" || undefined}
                  className="press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-body text-primary disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">Ya lo pagué</span>
                  {busy === "paid" && <BusySpinner />}
                </button>
              )}
              {(!template.currentPeriodPaid ||
                template.currentPeriodPaidManually) && (
                // Abre otra hoja: fila con chevron, como las de Ajustes.
                <button
                  type="button"
                  onClick={openPicker}
                  disabled={saving}
                  aria-busy={busy === "pick" || undefined}
                  className="press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-body disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">Elegir movimiento</span>
                  {busy === "pick" ? (
                    <BusySpinner />
                  ) : (
                    <ChevronRight aria-hidden className="disclosure" />
                  )}
                </button>
              )}
            </ModalSection>
          )}

          {/* El enlace guardado, para ir a pagar: fila de acción como un enlace de Contactos. Usa
              el valor guardado, no el que se está escribiendo abajo. */}
          {template?.url && (
            <ModalSection>
              <a
                href={template.url}
                target="_blank"
                rel="noopener noreferrer"
                className="press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-body text-primary"
              >
                <span className="min-w-0 flex-1 truncate">
                  Abrir {linkHost(template.url)}
                </span>
                <ArrowUpRight aria-hidden className="size-5 shrink-0" />
                <span className="sr-only">(se abre en otra pestaña)</span>
              </a>
            </ModalSection>
          )}

          <form
            id={formId}
            // Sin validación nativa: type="url" rechazaría «www.enel.cl», que el esquema completa.
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
            className="flex flex-col gap-7"
          >
            {/* 1 · Qué se cobra ---------------------------------------------- */}
            {/* La categoría la manda el movimiento, no la plantilla: si se pudiera editar en los
                dos lados habría dos verdades. Como una recurrente solo nace de un movimiento,
                la categoría siempre es heredada; se cambia recategorizando el movimiento. */}
            <ModalSection
              title="Qué se cobra"
              className="[--inset:1rem]"
              footer="El nombre es solo para reconocerla aquí; cambiarlo no afecta la detección del cargo en el correo."
            >
              <Input
                placeholder="Ej. Arriendo depto"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                aria-label="Nombre"
                className="h-11 rounded-none border-0 bg-transparent px-4 text-body shadow-none focus-visible:ring-0 md:text-body"
              />
              <div className="flex min-h-11 items-center gap-3 px-4 py-2">
                <CategoryIcon
                  icon={inheritedCategory?.icon ?? null}
                  size={18}
                  color={inheritedCategory?.color ?? undefined}
                />
                <span className="min-w-0 flex-1 truncate text-body">
                  {inheritedCategory?.name ?? "Sin categoría"}
                </span>
                <span className="shrink-0 text-subheadline text-muted-foreground">
                  Del movimiento
                </span>
              </div>
            </ModalSection>

            {/* 2 · Cuánto ---------------------------------------------------- */}
            {/* El rango ES el concepto de la recurrente: el cargo real varía mes a mes y aun así
                debe reconocerse. Por eso va en tamaño de dato, no en letra chica. */}
            <ModalSection title="Cuánto">
              <div className="flex items-baseline gap-2 px-4 py-2">
                <span className="text-title-1 font-semibold text-muted-foreground">
                  $
                </span>
                <Input
                  inputMode="numeric"
                  placeholder="0"
                  value={money.display}
                  onChange={(e) => money.onChange(e.target.value)}
                  aria-label="Monto base"
                  // md:text-large-title: el Input trae su tamaño de escritorio y dejaba el monto chico.
                  className="tabular h-12 min-w-0 border-0 bg-transparent px-0 text-large-title font-bold shadow-none focus-visible:ring-0 md:text-large-title"
                />
              </div>
              <div className="px-4 py-3">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-subheadline text-muted-foreground">
                    Reconoce cargos entre
                  </span>
                  <span className="tabular text-subheadline text-muted-foreground">
                    ±{tolerancePct}%
                  </span>
                </div>
                <div className="tabular flex flex-wrap items-baseline gap-x-2 text-headline">
                  <span>{fmt(min)}</span>
                  <span className="text-muted-foreground">—</span>
                  <span>{fmt(max)}</span>
                </div>
                <Slider
                  min={0}
                  max={50}
                  step={5}
                  value={[tolerancePct]}
                  onValueChange={([v]) => {
                    if (v === tolerancePct) return
                    haptic("light")
                    setTolerancePct(v)
                  }}
                  className="mt-2"
                  aria-label="Tolerancia del monto"
                  aria-valuetext={`Más o menos ${tolerancePct} por ciento`}
                />
              </div>
            </ModalSection>

            {/* 3 · Cuándo ---------------------------------------------------- */}
            <ModalSection
              title="Cuándo"
              footer={
                <>
                  {needsDay && (
                    <p>
                      Si el mes no tiene ese día (ej. 31 en febrero), se usa el
                      último.
                    </p>
                  )}
                  {/* La fecha en palabras: el input muestra 25/08/2027 y el año se lee de reojo.
                      Escrito completo, un error de año salta a la vista antes de guardar. */}
                  {endDate && (
                    <p>
                      {readableEnd(endDate)
                        ? `Se cobra hasta el ${readableEnd(endDate)}; después queda finalizada.`
                        : "El último cobro es el de esa fecha; después queda finalizada."}
                    </p>
                  )}
                </>
              }
            >
              <div className="px-4 py-2">
                <Segmented
                  value={periodicity}
                  options={PERIODICITIES}
                  onChange={(v) => {
                    haptic("light")
                    setPeriodicity(v)
                  }}
                  label="Frecuencia"
                />
              </div>
              {needsDay && (
                <div className="px-4 py-2">
                  <DayOfMonthPicker value={day} onChange={setDay} />
                </div>
              )}
              {withEnd ? (
                <div className="flex items-center gap-1 py-2 pr-1 pl-4">
                  <span className="min-w-0 flex-1">
                    <DatePicker
                      value={endDate}
                      onChange={setEndDate}
                      placeholder="Fecha de término"
                      fromDate={(
                        template?.startDate ?? new Date().toISOString()
                      ).slice(0, 10)}
                    />
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setWithEnd(false)
                      setEndDate("")
                    }}
                    className="press h-11 shrink-0 px-3 text-body text-primary hover:bg-transparent hover:text-primary"
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
                  className="press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-body"
                >
                  <span className="min-w-0 flex-1">Hasta cuándo</span>
                  <span className="shrink-0 text-muted-foreground">
                    No termina
                  </span>
                  <ChevronRight aria-hidden className="disclosure" />
                </button>
              )}
            </ModalSection>

            {/* Elección única entre cuentas, como en Ajustes de iOS: filas con ✓ en la elegida. */}
            <ModalSection title="Cuenta del cargo">
              {accounts.map((a) => {
                const selected = a.id === account?.id
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setAccountId(a.id)}
                    className="press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-body"
                  >
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    {selected && (
                      <Check
                        aria-hidden
                        className="size-5 shrink-0 text-primary"
                        strokeWidth={2.5}
                      />
                    )}
                  </button>
                )
              })}
            </ModalSection>

            {/* Enlace opcional al portal de pago: se abre después desde la recurrente. */}
            <ModalSection
              title="Enlace"
              className="[--inset:1rem]"
              footer={
                urlError ? (
                  <p
                    id="recurring-url-error"
                    role="alert"
                    className="text-destructive"
                  >
                    {urlError}
                  </p>
                ) : (
                  <span id="recurring-url-hint">
                    Opcional. El portal donde pagas esta cuenta, para abrirlo
                    desde aquí.
                  </span>
                )
              }
            >
              <Input
                id="recurring-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={RECURRING_URL_MAX}
                placeholder="www.enel.cl"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  if (urlError) setUrlError(null)
                }}
                // Al salir queda a la vista el enlace detectado («Paga en enel.cl» → https://enel.cl).
                onBlur={() => {
                  if (!url.trim()) return
                  const next = parseUrl()
                  if (next) setUrl(next)
                }}
                aria-label="Enlace"
                aria-invalid={!!urlError || undefined}
                aria-describedby={
                  urlError ? "recurring-url-error" : "recurring-url-hint"
                }
                className="h-11 rounded-none border-0 bg-transparent px-4 text-body shadow-none focus-visible:ring-0 aria-invalid:ring-0 md:text-body"
              />
            </ModalSection>
          </form>

          {/* Lo excepcional, como filas de texto bajo el formulario y lejos de Guardar: pausar y
              deshacer la marca manual del período. Eliminar va solo, en rojo y con confirmación. */}
          {template &&
            (!template.hasEnded ||
              (template.isActive && template.currentPeriodPaidManually)) && (
              <ModalSection>
                {!template.hasEnded && (
                  <button
                    type="button"
                    onClick={toggleActive}
                    disabled={saving}
                    aria-busy={busy === "toggle" || undefined}
                    className={ACTION_ROW}
                  >
                    {template.isActive
                      ? "Pausar recurrente"
                      : "Reanudar recurrente"}
                    {busy === "toggle" && <BusySpinner />}
                  </button>
                )}
                {template.isActive &&
                  !template.hasEnded &&
                  template.currentPeriodPaidManually && (
                    <button
                      type="button"
                      onClick={undoPaid}
                      disabled={saving}
                      aria-busy={busy === "undo" || undefined}
                      className={ACTION_ROW}
                    >
                      Deshacer «Ya lo pagué»
                      {busy === "undo" && <BusySpinner />}
                    </button>
                  )}
              </ModalSection>
            )}
          {template && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <ModalDangerRow
                  disabled={saving}
                  aria-busy={busy === "delete" || undefined}
                >
                  Eliminar recurrente
                  {busy === "delete" && <BusySpinner />}
                </ModalDangerRow>
              </AlertDialogTrigger>
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
                    onClick={remove}
                    variant="destructive"
                  >
                    Eliminar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {template && (
            <RecurringLinkPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              items={candidates}
              filters={filters}
              onFiltersChange={changeFilters}
              busy={busy === "pick"}
              onPick={pickTransaction}
              onRetry={() => loadCandidates(filters)}
            />
          )}
        </div>
      )}
    </ResponsiveModal>
  )
}

// Fila de acción de una lista agrupada: texto azul, 44 px de alto; el spinner va al final.
const ACTION_ROW =
  "press flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-body text-primary disabled:opacity-50"

// Indicador de actividad de una fila mientras escribe; quieto con «reducir movimiento».
function BusySpinner() {
  return (
    <Loader
      aria-hidden
      className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
    />
  )
}
