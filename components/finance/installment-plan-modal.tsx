"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
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
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { formatCLP } from "@/lib/finance-format"
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
    <li className="flex flex-col gap-2 border-b border-border/40 py-3 last:border-0">
      {/* Fecha y monto en filas propias: el texto de la fecha ("25 de diciembre de 2026") no cabe
          junto al monto en el ancho del drawer móvil. */}
      <div className="flex items-center gap-2">
        <span className="tabular w-6 shrink-0 text-xs text-muted-foreground">
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
            "tabular h-11 min-w-0 flex-1 rounded-lg bg-secondary/40 px-3 text-right text-base outline-none focus:bg-secondary",
            over && "ring-1 ring-destructive"
          )}
        />
      </div>
      {over ? (
        <p className="pl-8 text-xs text-destructive">
          Máximo {formatCLP(max)}: lo demás debe alcanzar para las cuotas
          pendientes.
        </p>
      ) : (
        max !== null &&
        changedAmount && (
          <p className="pl-8 text-xs text-muted-foreground">
            Las cuotas pendientes se recalculan para mantener el total.
          </p>
        )
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={() => onSave(new Date(`${date}T12:00:00`).toISOString(), amount)}
          disabled={busy || amount <= 0 || over}
        >
          Guardar
        </Button>
      </div>
    </li>
  )
}

const STATUS_LABEL: Record<string, string> = {
  paid: "Pagada",
  outside_app: "Pagada antes",
  overdue: "Vencida",
  upcoming: "Por venir",
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [linking, setLinking] = useState<
    InstallmentPlanDTO["items"][number] | null
  >(null)

  async function patch(body: object, ok: string, fail: string) {
    if (busy) return false
    setBusy(true)
    const res = await fetch(`/api/installments/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      haptic("error")
      toast.error(data.error ?? fail)
      return false
    }
    haptic("success")
    toast.success(ok)
    router.refresh()
    return true
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
  const pct = Math.round((plan.settledCount / plan.installmentsCount) * 100)

  // Último recurso: CREA el movimiento, para un pago que no dejó rastro en la app (pagaste desde
  // otro banco, el aviso nunca llegó). Si el movimiento existe hay que asignarlo, no crear otro.
  async function payManually(itemId: string, amount: number) {
    await patch(
      { itemId, paid: true, amount, date: new Date().toISOString() },
      "Movimiento creado y cuota registrada",
      "No se pudo registrar la cuota"
    )
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    const res = await fetch(`/api/installments/${plan.id}`, { method: "DELETE" })
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
      <div className="flex flex-col px-4">
        {/* Dato hero: lo que falta. El total pagado va debajo, como contexto. */}
        <section className="border-b border-border/60 py-5">
          <span className="tabular block text-3xl font-semibold">
            {formatCLP(plan.outstanding)}
          </span>
          <span className="block text-sm text-muted-foreground">
            por pagar de {formatCLP(plan.totalAmount)}
          </span>
          <span
            className="mt-3 block h-1.5 w-full overflow-hidden rounded-full bg-muted"
            aria-hidden
          >
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="mt-1.5 block text-xs text-muted-foreground">
            {plan.settledCount} de {plan.installmentsCount} cuotas ·{" "}
            {formatCLP(paidTotal)} pagados en {plan.accountName}
          </span>
        </section>

        {plan.kind === "loan" && (
          <p className="border-b border-border/60 py-4 text-xs text-muted-foreground">
            Cada cuota se registra con el monto que informa el correo del banco.
            Los montos de abajo son la estimación con la que se creó el plan.
          </p>
        )}

        <section className="py-5">
          <h3 className="mb-3 text-sm font-semibold">Cronograma</h3>
          <ul className="flex flex-col">
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
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 border-b border-border/40 py-2.5 last:border-0"
                >
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-medium",
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
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      {shortDate(item.dueDate)}
                    </span>
                    <span
                      className={cn(
                        "block text-xs",
                        item.status === "overdue"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      )}
                    >
                      {STATUS_LABEL[item.status]}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-medium">
                    {formatCLP(item.paidAmount ?? item.amount)}
                  </span>
                  {/* En card una cuota ya registrada sigue siendo editable: su movimiento es un
                      espejo del cronograma y la edición lo sincroniza. En loan el monto/fecha
                      reales los fijó el correo: registrada no se toca. */}
                  {(!settled || plan.kind === "card") && (
                    <button
                      type="button"
                      onClick={() => setEditingId(item.id)}
                      disabled={busy}
                      className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      Editar
                    </button>
                  )}
                  {/* Asignar va primero: el caso normal es que el gasto YA esté en la app y haya
                      que reconocerlo, no fabricar uno nuevo. */}
                  {!settled && (
                    <button
                      type="button"
                      onClick={() => setLinking(item)}
                      disabled={busy}
                      className="shrink-0 rounded-full border border-primary px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                    >
                      Asignar
                    </button>
                  )}
                  {/* Deshacer una asignación equivocada; si no, la única salida sería borrar el plan. */}
                  {item.status === "paid" && (
                    <button
                      type="button"
                      onClick={() =>
                        patch(
                          { itemId: item.id, unlink: true },
                          "Movimiento soltado",
                          "No se pudo soltar el movimiento"
                        )
                      }
                      disabled={busy}
                      className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      Soltar
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        {/* Selector de movimiento existente para la cuota elegida. La opción de crear uno queda
            explícitamente como salida de último recurso: crear cuando el gasto ya existe lo
            contaría dos veces. */}
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
              await payManually(linking.id, linking.amount)
              setLinking(null)
            }}
          />
        )}

        {/* La compra que dio origen al plan quedó neutralizada: dejó de contar como gasto, pero se
            conserva para poder ver cuánto cobró el banco de una vez. */}
        {plan.sourceTransactionId && (
          <p className="border-t border-border/60 py-4 text-xs text-muted-foreground">
            La compra original de {formatCLP(plan.totalAmount)} se conserva en
            tus movimientos, pero ya no cuenta como gasto: ahora lo hace cada
            cuota en su mes.
          </p>
        )}

        <ModalFooter>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Eliminar plan"
                className="size-12 shrink-0 rounded-full text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-5" />
              </Button>
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
                <AlertDialogAction onClick={remove}>Eliminar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            onClick={() => onOpenChange(false)}
            className="h-12 flex-1 rounded-full text-base"
          >
            Listo
          </Button>
        </ModalFooter>
      </div>
    </ResponsiveModal>
  )
}
