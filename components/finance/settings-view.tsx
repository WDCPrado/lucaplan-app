"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { BellRing, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { authClient } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"
import { PushToggle } from "@/components/pwa/push-toggle"
import { AppShell } from "./app-shell"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import type { BudgetAlert } from "@/arch/v1/domain/notifications/budget-alert.domain"

// Rango del slider = el del dominio. El 100% es el techo: pasado eso el aviso ya reporta el % real
// alcanzado. Paso de 5 para que el arrastre caiga en valores redondos.
const MIN = 5
const MAX = 100
const STEP = 5

export function SettingsView({
  user,
  alerts: initialAlerts,
  vapidPublicKey,
}: {
  user: { name: string; email: string; initial: string }
  alerts: BudgetAlert[]
  // Vacío = sin claves VAPID en el servidor: no hay push posible, la sección ni se ofrece.
  vapidPublicKey: string
}) {
  const router = useRouter()

  async function signOut() {
    await authClient.signOut()
    router.push("/login")
  }

  return (
    <AppShell
      user={{ name: user.name || user.email, initial: user.initial, email: user.email }}
      active="configuracion"
      onSignOut={signOut}
      title="Configuración"
    >
      <div className="mx-auto w-full max-w-4xl px-4 py-6 lg:px-8">
        <p className="mb-6 text-sm text-muted-foreground">
          Preferencias de la app. Valen para todo Luca Plan, no para un mes en
          particular.
        </p>
        <div className="space-y-4">
          {vapidPublicKey && (
            <section className="glass rounded-2xl p-5">
              <h2 className="mb-4 font-heading text-base font-bold">
                Notificaciones
              </h2>
              <PushToggle vapidPublicKey={vapidPublicKey} />
            </section>
          )}
          <BudgetAlertsSection initialAlerts={initialAlerts} />
        </div>
      </div>
    </AppShell>
  )
}

function BudgetAlertsSection({
  initialAlerts,
}: {
  initialAlerts: BudgetAlert[]
}) {
  const [alerts, setAlerts] = useState(initialAlerts)
  const [pending, setPending] = useState(false)

  // Primer múltiplo de 5 libre a partir del 50%: propuesta razonable para una alerta nueva.
  function freePercent(): number | null {
    const used = new Set(alerts.map((a) => a.percent))
    for (let p = 50; p <= MAX; p += STEP) if (!used.has(p)) return p
    for (let p = MIN; p < 50; p += STEP) if (!used.has(p)) return p
    return null
  }

  async function save(id: string | undefined, percent: number) {
    setPending(true)
    const res = await fetch("/api/budget-alerts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, percent }),
    })
    setPending(false)
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      toast.error(body?.error ?? "No se pudo guardar la alerta.")
      return null
    }
    haptic("light")
    return body as BudgetAlert
  }

  // El slider mueve el valor en local (fluido) y solo persiste al soltar (onValueCommit).
  function move(id: string, percent: number) {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, percent } : a))
    )
  }

  async function commit(alert: BudgetAlert, percent: number) {
    const saved = await save(alert.id, percent)
    // Rechazo (% duplicado, fuera de rango): se vuelve al valor guardado.
    if (!saved) setAlerts((prev) => prev.map((a) => (a.id === alert.id ? alert : a)))
  }

  async function add() {
    const percent = freePercent()
    if (percent === null) {
      toast.error("Ya no quedan porcentajes libres.")
      return
    }
    const saved = await save(undefined, percent)
    if (saved) setAlerts((prev) => [...prev, saved].sort((a, b) => a.percent - b.percent))
  }

  async function remove(id: string) {
    setPending(true)
    const res = await fetch(`/api/budget-alerts?id=${id}`, { method: "DELETE" })
    setPending(false)
    if (!res.ok) {
      toast.error("No se pudo eliminar la alerta.")
      return
    }
    setAlerts((prev) => prev.filter((a) => a.id !== id))
    toast.success("Alerta eliminada.")
  }

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-1 flex items-center gap-2">
        <BellRing className="size-4 text-muted-foreground" />
        <h2 className="font-heading text-base font-bold">
          Alertas de presupuesto
        </h2>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        Te avisamos cuando el gasto del mes cruza un porcentaje de tu límite
        global. Solo llega un aviso: el del umbral más alto que se cruzó. Si te
        pasas del 100%, el aviso dice cuánto (125%, 180%…).
      </p>

      {alerts.length === 0 ? (
        <p className="mb-5 rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          Sin alertas configuradas: no recibirás avisos de presupuesto.
        </p>
      ) : (
        <ul className="mb-5 space-y-5">
          {alerts.map((alert) => (
            <li key={alert.id} className="flex items-center gap-4">
              <span className="w-16 shrink-0 font-heading text-lg font-bold tabular-nums">
                {alert.percent}%
              </span>
              <Slider
                value={[alert.percent]}
                min={MIN}
                max={MAX}
                step={STEP}
                disabled={pending}
                aria-label={`Umbral de aviso: ${alert.percent}%`}
                onValueChange={([v]) => move(alert.id, v)}
                onValueCommit={([v]) => commit(alert, v)}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove(alert.id)}
                disabled={pending}
                aria-label={`Eliminar la alerta del ${alert.percent}%`}
                className="size-11 shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="outline"
        onClick={add}
        disabled={pending}
        className="h-11 rounded-full"
      >
        <Plus className="size-4" />
        Agregar alerta
      </Button>
    </section>
  )
}
