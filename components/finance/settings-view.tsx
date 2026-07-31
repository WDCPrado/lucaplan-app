"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BellRing, CalendarClock, Check, Minus, Plus } from "lucide-react"
import { toast } from "sonner"

import { authClient } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { PushToggle } from "@/components/pwa/push-toggle"
import { AppShell } from "./app-shell"
import { Button } from "@/components/ui/button"
import type { BudgetAlert } from "@/arch/v1/domain/notifications/budget-alert.domain"

// Umbrales ofrecidos. Son los que la gente usa: elegir "aviso al 80%" es una decisión discreta,
// no un continuo, y un slider de 700px para eso se lee como barra de progreso, no como control.
// Un umbral guardado fuera de esta lista igual aparece como chip (se puede quitar).
const PRESETS = [25, 50, 75, 80, 90, 100]

export function SettingsView({
  user,
  alerts: initialAlerts,
  dueDays,
  vapidPublicKey,
}: {
  user: { name: string; email: string; initial: string }
  alerts: BudgetAlert[]
  dueDays: number
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
      <div className="mx-auto w-full max-w-5xl px-4 pt-1 pb-6 lg:px-8 lg:py-6">
        <h1 className="font-heading text-xl font-bold md:sr-only">
          Configuración
        </h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Preferencias de la app. Valen para todo Luca Plan, no para un mes en
          particular.
        </p>
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          {vapidPublicKey && (
            <section className="glass rounded-2xl p-5 lg:col-span-2">
              <h2 className="mb-4 font-heading text-base font-bold">
                Notificaciones
              </h2>
              <PushToggle vapidPublicKey={vapidPublicKey} />
            </section>
          )}
          <BudgetAlertsSection initialAlerts={initialAlerts} />
          <DueReminderSection initialDays={dueDays} />
        </div>
      </div>
    </AppShell>
  )
}

// Anticipación del recordatorio de recurrentes y cuotas. Rango del dominio (0–14); 0 = el día del
// cobro. Stepper en vez de slider: son 15 valores enteros y el número es la información.
const DUE_MAX = 14

function DueReminderSection({ initialDays }: { initialDays: number }) {
  const [days, setDays] = useState(initialDays)
  const [pending, setPending] = useState(false)
  // Un POST por clic convertiría "subir a 5 días" en cinco guardados; se persiste al parar.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function change(next: number) {
    if (next < 0 || next > DUE_MAX) return
    haptic("light")
    setDays(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(next), 500)
  }

  async function commit(value: number) {
    setPending(true)
    const res = await fetch("/api/due-reminder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ days: value }),
    })
    setPending(false)
    if (!res.ok) {
      toast.error("No se pudo guardar la anticipación.")
      setDays(initialDays)
    }
  }

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-1 flex items-center gap-2">
        <CalendarClock className="size-4 text-muted-foreground" />
        <h2 className="font-heading text-base font-bold">Pagos por vencer</h2>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        Con cuánta anticipación te avisamos de recurrentes y cuotas por cobrar.
      </p>
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="icon"
          disabled={pending || days === 0}
          onClick={() => change(days - 1)}
          aria-label="Avisar un día menos antes"
          className="size-11 shrink-0 rounded-full"
        >
          <Minus className="size-4" />
        </Button>
        <p
          aria-live="polite"
          className="font-heading w-36 text-center text-lg font-bold tabular-nums"
        >
          {days === 0 ? "El mismo día" : `${days} día${days === 1 ? "" : "s"}`}
        </p>
        <Button
          variant="secondary"
          size="icon"
          disabled={pending || days === DUE_MAX}
          onClick={() => change(days + 1)}
          aria-label="Avisar un día más antes"
          className="size-11 shrink-0 rounded-full"
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {/* El ajuste se confirma con su efecto, no con el número suelto. */}
      <p className="mt-3 text-sm text-muted-foreground">
        {days === 0
          ? "Recibirás el aviso el mismo día del cobro."
          : `Un cobro del día 20 se avisaría el día ${20 - days}.`}
      </p>
    </section>
  )
}

function BudgetAlertsSection({
  initialAlerts,
}: {
  initialAlerts: BudgetAlert[]
}) {
  const [alerts, setAlerts] = useState(initialAlerts)
  const [pending, setPending] = useState<number | null>(null)

  // Presets + los umbrales guardados que no estén en la lista: nada configurado queda oculto.
  const percents = [
    ...new Set([...PRESETS, ...alerts.map((a) => a.percent)]),
  ].sort((a, b) => a - b)

  async function toggle(percent: number) {
    const existing = alerts.find((a) => a.percent === percent)
    setPending(percent)
    if (existing) {
      const res = await fetch(`/api/budget-alerts?id=${existing.id}`, {
        method: "DELETE",
      })
      setPending(null)
      if (!res.ok) return toast.error("No se pudo eliminar la alerta.")
      haptic("light")
      setAlerts((prev) => prev.filter((a) => a.id !== existing.id))
      return
    }
    const res = await fetch("/api/budget-alerts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ percent }),
    })
    const body = await res.json().catch(() => null)
    setPending(null)
    if (!res.ok) return toast.error(body?.error ?? "No se pudo guardar la alerta.")
    haptic("light")
    setAlerts((prev) =>
      [...prev, body as BudgetAlert].sort((a, b) => a.percent - b.percent)
    )
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
        Te avisamos cuando una categoría cruza estos porcentajes de{" "}
        <strong>su</strong> límite del mes. Valen para todas. Llega un solo
        aviso por categoría: el del umbral más alto que cruzó. Si te pasas del
        100%, el aviso dice cuánto (125%, 180%…).
      </p>

      <div className="flex flex-wrap gap-2">
        {percents.map((p) => {
          const on = alerts.some((a) => a.percent === p)
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              disabled={pending !== null}
              onClick={() => toggle(p)}
              className={cn(
                "tabular h-11 rounded-full border px-4 text-sm transition-colors disabled:opacity-60",
                on
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {on && <Check className="mr-1.5 inline size-3.5" />}
              {p}%
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        {alerts.length === 0
          ? "Sin alertas: no recibirás avisos de presupuesto."
          : `Avisaremos al ${alerts
              .map((a) => a.percent)
              .sort((a, b) => a - b)
              .join("%, ")}% del límite de cada categoría.`}
      </p>
    </section>
  )
}
