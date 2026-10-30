"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, MoreHorizontal } from "lucide-react"
import { toast } from "sonner"

import {
  ModalDangerRow,
  ModalFooter,
  ResponsiveModal,
} from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { formatCLP } from "@/lib/finance-format"
import { todayKey } from "@/arch/shared/today"
import { DatePicker } from "./transaction-modal"
import { InstallmentLinkPicker } from "./installment-link-picker"
import type { InstallmentPlanDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

// Edición en línea de una cuota: monto y vencimiento. Reemplaza la fila en vez de abrir otro
// modal — es un ajuste menor, no vale apilar superficies. En `card` el total del plan no se
// negocia: `max` acota el monto (lo demás debe alcanzar para las pendientes) y al guardar las
// pendientes se recalculan; null = sin tope (loan, donde el cronograma es estimación).
function ItemEditor({
  item,
  max,
  busy,
  onCancel,
  onSave,
}: {
  item: InstallmentPlanDTO["items"][number]
  max: number | null
  busy: boolean
  onCancel: () => void
  onSave: (dueDate: string, amount: number) => void
}) {
  const [amount, setAmount] = useState(item.amount)
  const [date, setDate] = useState(item.dueDate.slice(0, 10))
  const over = max !== null && amount > max
  const changedAmount = amount !== item.amount
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      {/* Fecha y monto en filas propias: el texto de la fecha ("25 de diciembre de 2026") no cabe
          junto al monto en el ancho del drawer móvil. */}
      <div className="flex items-center gap-2">
        <span className="tabular w-6 shrink-0 text-footnote text-muted-foreground">
          {item.index}
        </span>
        <div className="min-w-0 flex-1">
          <DatePicker value={date} onChange={setDate} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0" aria-hidden />
        <input
          inputMode="numeric"
          value={amount ? amount.toLocaleString("es-CL") : ""}
          onChange={(e) =>
            setAmount(Number(e.target.value.replace(/\D/g, "")) || 0)
          }
          aria-label={`Monto de la cuota ${item.index}`}
          aria-invalid={over}
          className={cn(
            "tabular h-11 min-w-0 flex-1 rounded-lg bg-(--glass-control) px-3 text-right text-body outline-none",
            over && "ring-1 ring-destructive"
          )}
        />
      </div>
      {over ? (
        <p className="pl-8 text-footnote text-destructive">
          Máximo <span className="tabular">{formatCLP(max)}</span>: lo demás
          debe alcanzar para las cuotas pendientes.
        </p>
      ) : (
        max !== null &&
        changedAmount && (
          <p className="pl-8 text-footnote text-muted-foreground">
            Las cuotas pendientes se recalculan para mantener el total.
          </p>
        )
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
          className="h-11 text-body"
        >
          Cancelar
        </Button>
        <Button
          type="button"
          className="h-11 text-body"
          onClick={() =>
            onSave(new Date(`${date}T12:00:00`).toISOString(), amount)
          }
          disabled={busy || amount <= 0 || over}
        >
          Guardar
        </Button>
      </div>
    </li>
  )
}

// Solo los estados que no se leen del ícono: el check ya dice pagada y el número, pendiente.
const STATUS_LABEL: Record<string, string> = {
  outside_app: "Pagada fuera de la app",
  overdue: "Vencida",
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC", // @db.Date es medianoche UTC: en local (Chile) mostraría el día anterior
  })
}

export function InstallmentPlanModal({
  open,
  onOpenChange,
  plan,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  plan: InstallmentPlanDTO
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const mutationInFlight = useRef(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [linking, setLinking] = useState<
    InstallmentPlanDTO["items"][number] | null
  >(null)

  async function patch(body: object, ok: string, fail: string) {
    if (mutationInFlight.current) return false
    mutationInFlight.current = true
    setBusy(true)
    try {
      const res = await fetch(`/api/installments/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? fail)
      haptic("success")
      toast.success(ok)
      router.refresh()
      return true
    } catch (error) {
      haptic("error")
      toast.error(error instanceof Error ? error.message : fail)
      return false
    } finally {
      mutationInFlight.current = false
      setBusy(false)
    }
  }

  async function saveItem(itemId: string, dueDate: string, amount: number) {
    const ok = await patch(
      { itemId, dueDate, amount },
      "Cuota actualizada",
      "No se pudo guardar la cuota"
    )
    if (ok) setEditingId(null)
  }

  const paidTotal = plan.totalAmount - plan.outstanding

  // El cronograma es suficiente para generar tanto cuotas de tarjeta como de consumo.
  // Usar su fecha conserva el mes/ciclo de la cuota al registrar pagos anteriores.
  async function payManually(item: InstallmentPlanDTO["items"][number]) {
    return patch(
      { itemId: item.id, paid: true, amount: item.amount, date: item.dueDate },
      "Movimiento generado y cuota pagada",
      "No se pudo generar la cuota"
    )
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    const res = await fetch(`/api/installments/${plan.id}`, {
      method: "DELETE",
    })
    setBusy(false)
    if (!res.ok) {
      haptic("error")
      return toast.error("No se pudo eliminar el plan")
    }
    haptic("success")
    toast.success("Plan eliminado")
    onOpenChange(false)
    router.refresh()
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={plan.description}
    >
      <div className="flex flex-col px-5">
        {/* Dato hero: lo que falta. El avance va debajo, como contexto. */}
        <section className="py-5">
          <span className="tabular block text-hero font-bold">
            {formatCLP(plan.outstanding)}
          </span>
          <span className="block text-subheadline text-muted-foreground">
            por pagar de{" "}
            <span className="tabular">{formatCLP(plan.totalAmount)}</span>
          </span>
          <span className="mt-1.5 block text-footnote text-muted-foreground">
            {plan.settledCount} de {plan.installmentsCount} cuotas ·{" "}
            <span className="tabular">{formatCLP(paidTotal)}</span> pagados en{" "}
            {plan.accountName}
          </span>
        </section>

        <section className="pb-5">
          <h3 className="mb-2 px-4 text-headline font-semibold">Cronograma</h3>
          <ul className="sheet-group inset-list flex flex-col [--inset:3.25rem]">
            {plan.items.map((item) => {
              const settled =
                item.status === "paid" || item.status === "outside_app"
              if (editingId === item.id) {
                // Tope en card: total − cuotas saldadas (no se mueven) − $1 por cada pendiente
                // que absorbe el resto (una cuota de $0 no es una cuota). Espejo del use-case.
                const others = plan.items.filter((i) => i.id !== item.id)
                const settledOthers = others.filter(
                  (i) => i.status === "paid" || i.status === "outside_app"
                )
                const fixed = settledOthers.reduce((s, i) => s + i.amount, 0)
                const max =
                  plan.kind === "card"
                    ? plan.totalAmount -
                      fixed -
                      (others.length - settledOthers.length)
                    : null
                return (
                  <ItemEditor
                    key={item.id}
                    item={item}
                    max={max}
                    busy={busy}
                    onCancel={() => setEditingId(null)}
                    onSave={(dueDate, amount) =>
                      saveItem(item.id, dueDate, amount)
                    }
                  />
                )
              }
              // En card una cuota ya registrada sigue siendo editable: su movimiento es un espejo
              // del cronograma y la edición lo sincroniza. En loan el monto/fecha reales quedan
              // registrados en el movimiento: pagada no se toca.
              const canEdit = !settled || plan.kind === "card"
              // Deshacer una asignación equivocada; si no, la única salida sería borrar el plan.
              const canUnlink = item.status === "paid"
              const notDueYet = item.dueDate.slice(0, 10) > todayKey()
              const status = STATUS_LABEL[item.status]
              return (
                // Fila limpia (n.º, fecha, monto) con el menú «…» a la derecha. «Generar cuota»
                // aparece solo en la que ya se puede generar (vencida o del día): en las futuras
                // sería un botón muerto.
                <li key={item.id} className="flex flex-col py-1 pr-1 pl-4">
                  <div className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3">
                    <span
                      className={cn(
                        "tabular grid size-6 shrink-0 place-items-center rounded-full text-caption font-medium",
                        item.status === "paid" && "bg-primary/15 text-primary",
                        item.status === "outside_app" &&
                          "bg-muted text-muted-foreground",
                        item.status === "overdue" &&
                          "bg-destructive/15 text-destructive",
                        item.status === "upcoming" &&
                          "bg-muted text-muted-foreground"
                      )}
                      aria-hidden
                    >
                      {item.status === "paid" ? (
                        <Check className="size-3.5" />
                      ) : (
                        item.index
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-body">
                        {shortDate(item.dueDate)}
                        {/* El estado pagada/pendiente lo dice el ícono; para el lector, en texto. */}
                        {!status && (
                          <span className="sr-only">
                            {settled ? ", pagada" : ", pendiente"}
                          </span>
                        )}
                      </span>
                      {status && (
                        <span
                          className={cn(
                            "block text-footnote",
                            item.status === "overdue"
                              ? "text-destructive"
                              : "text-muted-foreground"
                          )}
                        >
                          {status}
                        </span>
                      )}
                    </span>
                    <span className="tabular shrink-0 text-body font-medium">
                      {formatCLP(item.paidAmount ?? item.amount)}
                    </span>
                    {!settled || canEdit || canUnlink ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            aria-label={`Más acciones de la cuota ${item.index}`}
                            className="size-11 shrink-0 text-muted-foreground"
                          >
                            <MoreHorizontal className="size-5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canEdit && (
                            <DropdownMenuItem
                              onSelect={() => setEditingId(item.id)}
                            >
                              Editar
                            </DropdownMenuItem>
                          )}
                          {!settled && (
                            <DropdownMenuItem onSelect={() => setLinking(item)}>
                              Asignar existente
                            </DropdownMenuItem>
                          )}
                          {canUnlink && (
                            <DropdownMenuItem
                              onSelect={() =>
                                patch(
                                  { itemId: item.id, unlink: true },
                                  "Movimiento soltado",
                                  "No se pudo soltar el movimiento"
                                )
                              }
                            >
                              Soltar
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="size-11" aria-hidden />
                    )}
                  </div>
                  {!settled && !notDueYet && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => payManually(item)}
                      disabled={busy}
                      className="press ml-6 h-11 self-start px-3 text-body font-semibold text-primary hover:bg-transparent hover:text-primary"
                    >
                      Generar cuota
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        {/* Asignar es opcional: solo se busca cuando ya hay un movimiento. */}
        {linking && (
          <InstallmentLinkPicker
            open
            onOpenChange={(o) => !o && setLinking(null)}
            around={linking.dueDate}
            accountId={plan.accountId}
            expectedAmount={linking.amount}
            categoryId={plan.categoryId}
            categoryName={plan.categoryName}
            onPick={async (transactionId) => {
              const ok = await patch(
                { itemId: linking.id, transactionId },
                "Movimiento asignado a la cuota",
                "No se pudo asignar el movimiento"
              )
              if (ok) setLinking(null)
            }}
            onCreate={async () => {
              const ok = await payManually(linking)
              if (ok) setLinking(null)
            }}
          />
        )}

        {/* La compra que dio origen al plan quedó neutralizada: dejó de contar como gasto, pero se
            conserva para poder ver cuánto cobró el banco de una vez. */}
        {plan.sourceTransactionId && (
          <p className="px-4 pb-4 text-footnote text-muted-foreground">
            La compra original de{" "}
            <span className="tabular">{formatCLP(plan.totalAmount)}</span> se
            conserva en tus movimientos, pero ya no cuenta como gasto: ahora lo
            hace cada cuota en su mes.
          </p>
        )}

        {/* Eliminar es destructivo y excepcional: fila de texto roja al final del cuerpo, lejos
            de «Listo». */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <ModalDangerRow disabled={busy}>Eliminar plan</ModalDangerRow>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar este plan?</AlertDialogTitle>
              <AlertDialogDescription>
                {plan.kind === "card" &&
                plan.sourceTransactionId &&
                !plan.items.some((i) => i.status === "paid")
                  ? "La compra original vuelve a contar como gasto normal en su mes, como antes de pasarla a cuotas."
                  : "Los movimientos de las cuotas ya registradas se conservan: son gastos que ocurrieron. Solo desaparece el plan que los agrupa."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={remove} variant="destructive">
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <ModalFooter>
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-12 flex-1 text-body"
          >
            Listo
          </Button>
        </ModalFooter>
      </div>
    </ResponsiveModal>
  )
}
