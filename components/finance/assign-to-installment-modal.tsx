"use client"
import { Button } from "glisse"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Plus } from "lucide-react"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { formatCLP } from "@/lib/finance-format"
import { CategoryIcon } from "./category-icons"
import type { InstallmentPlanDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC", // @db.Date es medianoche UTC: en local (Chile) mostraría el día anterior
  })
}

/**
 * Marca un movimiento existente como la cuota de un plan, desde el propio movimiento. Es el camino
 * inverso al del plan y resuelve el caso que el enganche automático no cubre: el plan se creó
 * después del cargo, el pago quedó ambiguo entre dos créditos, o el banco describió distinto.
 *
 * Nunca crea nada: este movimiento PASA A SER la cuota.
 */
export function AssignToInstallmentModal({
  open,
  onOpenChange,
  transactionId,
  onAssigned,
  onCreateLoan,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  transactionId: string
  onAssigned: () => void
  /** El crédito de esta cuota todavía no existe como plan: salir a registrarlo desde aquí. */
  onCreateLoan?: () => void
}) {
  const router = useRouter()
  const [plans, setPlans] = useState<InstallmentPlanDTO[] | null>(null)
  const [planId, setPlanId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Efecto genuino: se consulta la API al abrirse, desde una interacción del cliente.
  useEffect(() => {
    if (!open) return
    let alive = true
    fetch("/api/installments")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: InstallmentPlanDTO[]) => {
        if (!alive) return
        // Solo planes que tengan alguna cuota esperando: el resto no puede recibir nada.
        const open = data.filter((p) =>
          p.items.some((i) => i.status === "overdue" || i.status === "upcoming")
        )
        setPlans(open)
        if (open.length === 1) setPlanId(open[0].id)
      })
      .catch(() => alive && setPlans([]))
    return () => {
      alive = false
    }
  }, [open])

  const plan = plans?.find((p) => p.id === planId) ?? null

  async function assign(itemId: string) {
    if (busy || !plan) return
    setBusy(true)
    const res = await fetch(`/api/installments/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, transactionId }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      haptic("error")
      return toast.error(data.error ?? "No se pudo asignar a la cuota")
    }
    haptic("success")
    toast.success("Movimiento asignado a la cuota")
    onOpenChange(false)
    router.refresh()
    onAssigned()
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Marcar como cuota"
    >
      <div className="flex flex-col px-5 pb-4">
        {plans === null ? (
          <p className="py-8 text-center text-subheadline text-muted-foreground">
            Buscando planes…
          </p>
        ) : plans.length === 0 ? (
          <p className="py-8 text-center text-subheadline text-balance text-muted-foreground">
            {onCreateLoan
              ? "No tienes planes de cuotas con cuotas pendientes. Registra el crédito y este pago quedará enganchado como su cuota."
              : "No tienes planes de cuotas con cuotas pendientes. Crea uno desde Cuotas, o pasa una compra de tarjeta a cuotas."}
          </p>
        ) : !plan ? (
          <>
            <p className="py-3 text-subheadline">
              ¿De qué deuda es este pago?
            </p>
            <ul className="sheet-group inset-list flex flex-col overflow-hidden [--inset:4.5rem]">
              {plans.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setPlanId(p.id)}
                    className="press flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left"
                  >
                    <span
                      className="grid size-11 shrink-0 place-items-center rounded-full bg-muted"
                      aria-hidden
                    >
                      <CategoryIcon
                        icon={p.categoryIcon}
                        size={16}
                        color={p.categoryColor ?? undefined}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-subheadline font-medium">
                        {p.description}
                      </span>
                      <span className="block truncate text-footnote text-muted-foreground">
                        cuota {p.settledCount} de {p.installmentsCount} ·{" "}
                        {formatCLP(p.outstanding)} por pagar
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 py-3">
              <p className="text-subheadline">
                ¿Qué cuota de {plan.description} salda?
              </p>
              {(plans?.length ?? 0) > 1 && (
                <Button
                  type="button"
                  onClick={() => setPlanId(null)}
                  className="min-h-11 shrink-0 text-subheadline text-primary"
                >
                  Cambiar
                </Button>
              )}
            </div>
            <ul className="sheet-group inset-list flex flex-col overflow-hidden [--inset:3.25rem]">
              {plan.items
                .filter(
                  (i) => i.status === "overdue" || i.status === "upcoming"
                )
                .map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => assign(item.id)}
                      disabled={busy}
                      className="press flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left disabled:opacity-50"
                    >
                      <span className="tabular w-6 shrink-0 text-footnote text-muted-foreground">
                        {item.index}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-subheadline">
                          {shortDate(item.dueDate)}
                        </span>
                        <span
                          className={cn(
                            "block text-footnote",
                            item.status === "overdue"
                              ? "text-destructive"
                              : "text-muted-foreground"
                          )}
                        >
                          {item.status === "overdue" ? "Vencida" : "Por venir"}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-subheadline font-medium">
                        {formatCLP(item.amount)}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </>
        )}
        {/* La deuda puede no estar registrada todavía (el caso típico: la cuota llega por correo
            antes de que exista el plan). La salida de crear vive aquí, junto a la pregunta. */}
        {plans !== null && onCreateLoan && (
          <div className="sheet-group mt-6 overflow-hidden">
            <button
              type="button"
              onClick={onCreateLoan}
              className="press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-body text-primary"
            >
              <Plus className="size-5 shrink-0" />
              Registrar un crédito nuevo
            </button>
          </div>
        )}
      </div>
    </ResponsiveModal>
  )
}
