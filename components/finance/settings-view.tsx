"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight, Minus, Plus } from "lucide-react"
import { toast } from "sonner"
import type { PaceFrequency } from "@/arch/v1/domain/finance/pace.domain"

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
  paceFrequency,
  vapidPublicKey,
}: {
  user: { name: string; email: string; initial: string }
  alerts: BudgetAlert[]
  dueDays: number
  paceFrequency: PaceFrequency
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
      title="Ajustes"
    >
      <div className="mx-auto w-full max-w-5xl px-4 pt-1 pb-6 md:pt-6 lg:px-8">
        {/* Móvil: título grande de iOS bajo la barra; en escritorio el título vive en el topbar. */}
        <h1 className="mb-3 text-large-title font-bold md:hidden">Ajustes</h1>
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
          {vapidPublicKey && (
            <SettingsSection title="Notificaciones" className="lg:col-span-2">
              <div className="glass rounded-xl p-4">
                <PushToggle vapidPublicKey={vapidPublicKey} />
              </div>
            </SettingsSection>
          )}
          <BudgetAlertsSection initialAlerts={initialAlerts} />
          <DueReminderSection initialDays={dueDays} />
          <PaceSection initialFrequency={paceFrequency} />
          {/* Una fila que lleva a otra pantalla: chevron y nada más, como en Ajustes de iOS. */}
          <div className="glass overflow-hidden rounded-xl">
            <Link
              href="/plugin"
              className="press flex min-h-11 items-center justify-between gap-3 py-3 pr-3 pl-4 text-body hover:bg-accent/60"
            >
              Conexiones del plugin
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

// Sección de lista agrupada: título y una frase fuera de la tarjeta; el control, dentro.
function SettingsSection({
  title,
  description,
  className,
  children,
}: {
  title: string
  description?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <h2 className="text-title-3 font-bold">{title}</h2>
      {description && (
        <p className="mt-1 text-subheadline text-muted-foreground">{description}</p>
      )}
      <div className="mt-3">{children}</div>
    </section>
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
    <SettingsSection
      title="Pagos por vencer"
      description="Cuántos días antes te avisamos de recurrentes y cuotas."
    >
      <div className="glass rounded-xl p-4">
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="icon"
          disabled={pending || days === 0}
          onClick={() => change(days - 1)}
          aria-label="Avisar un día menos antes"
          className="size-11 shrink-0"
        >
          <Minus className="size-4" />
        </Button>
        <p
          aria-live="polite"
          className="tabular flex-1 text-center text-title-3 font-bold"
        >
          {days === 0 ? "El mismo día" : `${days} día${days === 1 ? "" : "s"}`}
        </p>
        <Button
          variant="secondary"
          size="icon"
          disabled={pending || days === DUE_MAX}
          onClick={() => change(days + 1)}
          aria-label="Avisar un día más antes"
          className="size-11 shrink-0"
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {/* El ajuste se confirma con su efecto, no con el número suelto. */}
      <p className="mt-3 text-center text-subheadline text-muted-foreground">
        {days === 0
          ? "Recibirás el aviso el mismo día del cobro."
          : `Un cobro del día 20 se avisaría el día ${20 - days}.`}
      </p>
      </div>
    </SettingsSection>
  )
}

// Frecuencia del ritmo de gasto que muestra cada categoría en el inicio: lo gastado del período
// contra el presupuesto del período. Dos valores excluyentes → control segmentado de iOS.
const PACE_OPTIONS: { value: PaceFrequency; label: string }[] = [
  { value: "weekly", label: "Semanal" },
  { value: "daily", label: "Diario" },
]

function PaceSection({
  initialFrequency,
}: {
  initialFrequency: PaceFrequency
}) {
  const [frequency, setFrequency] = useState(initialFrequency)
  const [pending, setPending] = useState(false)

  async function change(next: PaceFrequency) {
    if (next === frequency || pending) return
    haptic("light")
    const prev = frequency
    setFrequency(next)
    setPending(true)
    const res = await fetch("/api/pace-frequency", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ frequency: next }),
    })
    setPending(false)
    if (!res.ok) {
      toast.error("No se pudo guardar la frecuencia.")
      setFrequency(prev)
    }
  }

  return (
    <SettingsSection
      title="Ritmo de gasto"
      description={
        frequency === "weekly"
          ? "La semana parte el lunes aunque la mires el jueves."
          : "Un gasto grande puede reventar el día; la semana lo absorbe mejor."
      }
    >
      <div
        role="radiogroup"
        aria-label="Frecuencia del ritmo"
        className="flex gap-0.5 rounded-lg bg-(--glass-control) p-0.5"
      >
        {PACE_OPTIONS.map((opt) => {
          const active = opt.value === frequency
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={pending}
              onClick={() => change(opt.value)}
              className={cn(
                "h-11 flex-1 rounded-md px-4 text-subheadline font-medium transition-colors disabled:opacity-60",
                active
                  ? "bg-(--glass-control-active) text-foreground shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </SettingsSection>
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
    <SettingsSection
      title="Alertas de presupuesto"
      description="Te avisamos cuando una categoría cruza estos % de su límite."
    >
      {/* Grilla de tres y no wrap: seis chips en flex se partían 5 + 1. */}
      <div className="grid grid-cols-3 gap-2">
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
                "tabular h-11 rounded-lg px-3 text-subheadline transition-colors disabled:opacity-60",
                on
                  ? "bg-primary text-primary-foreground"
                  : "bg-(--glass-control) text-muted-foreground hover:text-foreground"
              )}
            >
              {p}%
            </button>
          )
        })}
      </div>
    </SettingsSection>
  )
}
