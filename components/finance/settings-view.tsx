"use client"

import { useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight, Minus, Plus } from "lucide-react"
import { toast } from "sonner"
import type { PaceFrequency } from "@/arch/v1/domain/finance/pace.domain"

import { authClient } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { useAppearance } from "@/components/appearance-provider"
import { PushToggle } from "@/components/pwa/push-toggle"
import { InstallAppItem } from "@/components/pwa/install-app-item"
import { AppShell, useOpenProfile } from "./app-shell"
import { Segmented } from "./segmented"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { GLASS_DEFAULT, GLASS_MAX, getGlass, setGlass, subscribeGlass } from "@/lib/glass-level"
import type { BudgetAlert } from "@/arch/v1/domain/notifications/budget-alert.domain"

// Umbrales ofrecidos. Son los que la gente usa: elegir "aviso al 80%" es una decisión discreta,
// no un continuo, y un slider de 700px para eso se lee como barra de progreso, no como control.
// Un umbral guardado fuera de esta lista igual aparece como chip (se puede quitar).
const PRESETS = [25, 50, 75, 80, 90, 100]

// Fila de 44 px de una lista agrupada que hace algo al tocarla (sin navegar).
const ROW =
  "press flex min-h-11 w-full items-center gap-3 py-3 pr-4 pl-4 text-left text-body hover:bg-accent/60"

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
  const { toggleTheme } = useAppearance()
  const openProfile = useOpenProfile()

  async function signOut() {
    await authClient.signOut()
    router.push("/login")
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl px-4 pt-1 pb-6 md:pt-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
          {/* Móvil: la cuenta, como en Ajustes de iOS (en escritorio vive en el pie del sidebar). */}
          <section aria-label="Cuenta" className="glass inset-list overflow-hidden rounded-xl md:hidden">
            {/* Abre la hoja del perfil (vive en el AppFrame); no navega. */}
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => openProfile?.()}
              className="press flex min-h-15 w-full items-center gap-3 py-2 pr-3 pl-4 text-left hover:bg-accent/60"
            >
              <span
                aria-hidden
                className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-headline font-semibold text-primary-foreground"
              >
                {user.initial}
              </span>
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-headline font-semibold">
                  {user.name || user.email}
                </span>
                {user.name && (
                  <span className="truncate text-footnote text-muted-foreground">
                    {user.email}
                  </span>
                )}
              </span>
              <ChevronRight aria-hidden className="disclosure" />
            </button>
            <button
              type="button"
              onClick={() => {
                haptic("light")
                toggleTheme()
              }}
              className={ROW}
            >
              Tema
              {/* El valor por CSS anclado al <html> (next-themes), como en el menú: sin mismatch de
                  hidratación ni useEffect. */}
              <span className="ml-auto text-muted-foreground">
                <span className="hidden [html.dark_&]:inline">Oscuro</span>
                <span className="[html.dark_&]:hidden">Claro</span>
              </span>
            </button>
            {/* Solo aparece si hay vía de instalación y la app no corre ya instalada. */}
            <InstallAppItem rowClassName={ROW} />
          </section>
          <AppearanceSection />
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
              <ChevronRight aria-hidden className="disclosure" />
            </Link>
          </div>
          <div className="glass overflow-hidden rounded-xl md:hidden">
            <button
              type="button"
              onClick={signOut}
              className="press flex min-h-11 w-full items-center justify-center px-4 py-3 text-body text-destructive hover:bg-accent/60"
            >
              Cerrar sesión
            </button>
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

// Lo que lee el lector de pantalla en cada paso (0 a GLASS_MAX); el 2 es el por defecto.
const GLASS_NAMES = ["Más transparente", "Transparente", "Normal", "Teñido", "Muy teñido"]

// Cuánto vidrio llevan barras, sidebar y menús: de transparente (el de siempre) a teñido, casi
// sólido. Cinco pasos; es del usuario (en la base): se ve al arrastrar y se guarda al soltar.
function AppearanceSection() {
  const { saveGlass } = useAppearance()
  // En el servidor no hay <html> que leer: parte en el nivel por defecto y al hidratar toma el del
  // <html>, que ya trae el del usuario (script del layout).
  const level = useSyncExternalStore(subscribeGlass, getGlass, () => GLASS_DEFAULT)

  return (
    <SettingsSection
      title="Apariencia"
      description="Cuánto se ve el contenido a través de las barras y los menús."
    >
      <div className="glass rounded-xl p-4">
        <Slider
          value={[level]}
          onValueChange={([v]) => {
            if (v === level) return
            haptic("light")
            setGlass(v)
          }}
          onValueCommit={([v]) => saveGlass(v)}
          min={0}
          max={GLASS_MAX}
          step={1}
          aria-label="Efecto vidrio"
          aria-valuetext={GLASS_NAMES[level]}
          className="h-11"
        />
        <div
          aria-hidden
          className="flex justify-between text-footnote text-muted-foreground"
        >
          <span>Transparente</span>
          <span>Teñido</span>
        </div>
        {/* Con «Reducir transparencia» del sistema todo material es sólido, sea cual sea el nivel. */}
        <p className="mt-3 hidden text-footnote text-muted-foreground [@media(prefers-reduced-transparency:reduce)]:block">
          Tu dispositivo tiene activado «Reducir transparencia»: el vidrio se ve sólido igual.
        </p>
      </div>
    </SettingsSection>
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
      <Segmented
        label="Frecuencia del ritmo"
        value={frequency}
        options={PACE_OPTIONS}
        onChange={change}
        disabled={pending}
      />
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
