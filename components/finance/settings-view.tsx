"use client"

import { useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, ChevronRight, Minus, Plus } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { GLASS_DEFAULT, GLASS_MAX, getGlass, setGlass, subscribeGlass } from "@/lib/glass-level"
import type { BudgetAlert } from "@/arch/v1/domain/notifications/budget-alert.domain"

// Umbrales ofrecidos. Elegir "aviso al 80%" es una decisión discreta, no un continuo. Un umbral
// guardado fuera de esta lista igual aparece como fila (se puede quitar).
const PRESETS = [25, 50, 75, 80, 90, 100]

// Grupo inset grouped sobre el fondo de la página: celda sólida (card), separadores con inset.
const GROUP = "inset-list overflow-hidden rounded-xl bg-card"
// Fila de 44 px de un grupo que hace algo al tocarla (sin navegar).
const ROW =
  "press flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-body hover:bg-accent/60 disabled:opacity-50"
// Fila con un control a la derecha (switch, stepper): el control fija el alto.
const CONTROL_ROW = "flex min-h-11 items-center gap-3 py-1.5 pr-4 pl-4"

// Modo oscuro leído del <html> (next-themes pone la clase antes del primer pintado). En el servidor
// no hay <html>: parte apagado y al hidratar toma el real, sin mismatch ni useEffect.
function subscribeDark(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
  return () => observer.disconnect()
}
const getDark = () => document.documentElement.classList.contains("dark")

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
  const { toggleTheme } = useAppearance()
  const openProfile = useOpenProfile()
  const dark = useSyncExternalStore(subscribeDark, getDark, () => false)

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl px-4 pt-1 pb-6 md:pt-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
          {/* Móvil: la cuenta, como en Ajustes de iOS (en escritorio vive en el pie del sidebar). */}
          <section aria-label="Cuenta" className={cn(GROUP, "md:hidden")}>
            {/* Abre la hoja del perfil (vive en el AppFrame); no navega. */}
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => openProfile?.()}
              className="press flex min-h-15 w-full items-center gap-3 py-2 pr-4 pl-4 text-left hover:bg-accent/60"
            >
              <span
                aria-hidden
                className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-headline font-semibold text-primary-foreground"
              >
                {user.initial}
              </span>
              <span className="grid min-w-0 flex-1">
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
            {/* Booleano → switch, como el modo oscuro de iOS. El tema se guarda en la base. */}
            <div className={CONTROL_ROW}>
              <label htmlFor="settings-dark" className="flex-1 text-body">
                Modo oscuro
              </label>
              <Switch
                id="settings-dark"
                checked={dark}
                onCheckedChange={() => {
                  haptic("light")
                  toggleTheme()
                }}
              />
            </div>
            {/* Acción (no navega): texto azul. Solo aparece si hay vía de instalación. */}
            <InstallAppItem rowClassName={cn(ROW, "text-primary")} />
          </section>
          <AppearanceSection />
          {vapidPublicKey && (
            <SettingsSection
              title="Notificaciones"
              footer={
                <p id="settings-push-hint">
                  Movimientos nuevos de tu banco, alertas de presupuesto y pagos
                  por vencer. En iPhone o iPad abre la app desde la pantalla de
                  inicio.
                </p>
              }
            >
              <div className={GROUP}>
                <PushToggle
                  vapidPublicKey={vapidPublicKey}
                  className={CONTROL_ROW}
                  describedBy="settings-push-hint"
                />
              </div>
            </SettingsSection>
          )}
          <BudgetAlertsSection initialAlerts={initialAlerts} />
          <DueReminderSection initialDays={dueDays} />
          <PaceSection initialFrequency={paceFrequency} />
          {/* Una fila que lleva a otra pantalla: chevron, como en Ajustes de iOS. */}
          <div className={GROUP}>
            <Link
              href="/plugin"
              className="press flex min-h-11 items-center gap-3 px-4 py-2.5 text-body hover:bg-accent/60"
            >
              <span className="flex-1">Conexiones del plugin</span>
              <ChevronRight aria-hidden className="disclosure" />
            </Link>
          </div>
          <SignOutRow />
        </div>
      </div>
    </AppShell>
  )
}

// Sección inset grouped, igual que `ModalSection` de las hojas: encabezado arriba del grupo y la
// explicación como pie, en footnote.
function SettingsSection({
  title,
  footer,
  className,
  children,
}: {
  title: string
  footer?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <h2 className="px-4 pb-2 text-headline font-semibold">{title}</h2>
      {children}
      {footer && (
        <div className="px-4 pt-2 text-footnote text-muted-foreground">
          {footer}
        </div>
      )}
    </section>
  )
}

// Fila roja centrada al final, con la alerta de iOS para confirmar. Solo móvil: en escritorio la
// cuenta vive en el pie del sidebar.
function SignOutRow() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    try {
      await authClient.signOut()
      router.push("/login")
    } catch {
      toast.error("No se pudo cerrar la sesión. Inténtalo de nuevo.")
      setPending(false)
    }
  }

  return (
    <div className={cn(GROUP, "md:hidden")}>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            disabled={pending}
            aria-busy={pending || undefined}
            className={cn(ROW, "justify-center text-center text-destructive")}
          >
            Cerrar sesión
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar sesión?</AlertDialogTitle>
            <AlertDialogDescription>
              Para volver a entrar te enviaremos un código a tu correo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={signOut}>
              Cerrar sesión
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
      footer={
        <>
          <p>Cuánto se ve el contenido a través de las barras y los menús.</p>
          {/* Con «Reducir transparencia» del sistema todo material es sólido, sea cual sea el nivel. */}
          <p className="mt-1 hidden [@media(prefers-reduced-transparency:reduce)]:block">
            Tu dispositivo tiene activado «Reducir transparencia»: el vidrio se
            ve sólido igual.
          </p>
        </>
      }
    >
      <div className="rounded-xl bg-card px-4 pt-2 pb-3">
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
          className="flex justify-between px-[1.1875rem] text-footnote text-muted-foreground"
        >
          <span>Transparente</span>
          <span>Teñido</span>
        </div>
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
  // Lo último que confirmó el servidor: si un guardado falla, se vuelve ahí (no al valor inicial).
  const saved = useRef(initialDays)
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
    try {
      const res = await fetch("/api/due-reminder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days: value }),
      })
      if (!res.ok) throw new Error()
      saved.current = value
    } catch {
      toast.error("No se pudo guardar la anticipación.")
      setDays(saved.current)
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingsSection
      title="Pagos por vencer"
      footer={
        // El ajuste se confirma con su efecto, no con el número suelto.
        days === 0
          ? "Recibirás el aviso el mismo día del cobro."
          : `Un cobro del día 20 se avisaría el día ${20 - days}.`
      }
    >
      <div className={GROUP}>
        <div className={cn(CONTROL_ROW, "pr-2")}>
          <p aria-live="polite" className="tabular flex-1 text-body">
            {days === 0
              ? "El mismo día"
              : `${days} día${days === 1 ? "" : "s"} antes`}
          </p>
          <Button
            variant="secondary"
            size="icon"
            disabled={pending || days === 0}
            onClick={() => change(days - 1)}
            aria-label="Avisar un día menos antes"
            className="size-11"
          >
            <Minus />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            disabled={pending || days === DUE_MAX}
            onClick={() => change(days + 1)}
            aria-label="Avisar un día más antes"
            className="size-11"
          >
            <Plus />
          </Button>
        </div>
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
    try {
      const res = await fetch("/api/pace-frequency", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frequency: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      toast.error("No se pudo guardar la frecuencia.")
      setFrequency(prev)
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingsSection
      title="Ritmo de gasto"
      footer={
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

// Selección múltiple de umbrales: filas con ✓, como una lista de iOS que admite varias marcas.
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
    if (pending !== null) return
    const existing = alerts.find((a) => a.percent === percent)
    haptic("light")
    setPending(percent)
    // El mensaje de la API, si trae uno; una caída de red cae al genérico.
    let error: string | null = null
    try {
      if (existing) {
        const res = await fetch(`/api/budget-alerts?id=${existing.id}`, {
          method: "DELETE",
        })
        if (res.ok) setAlerts((prev) => prev.filter((a) => a.id !== existing.id))
        else error = "No se pudo eliminar la alerta."
      } else {
        const res = await fetch("/api/budget-alerts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ percent }),
        })
        const body = await res.json().catch(() => null)
        if (res.ok)
          setAlerts((prev) =>
            [...prev, body as BudgetAlert].sort((a, b) => a.percent - b.percent)
          )
        else error = body?.error ?? "No se pudo guardar la alerta."
      }
    } catch {
      error = "No se pudo guardar la alerta."
    } finally {
      setPending(null)
    }
    if (error) toast.error(error)
  }

  return (
    <SettingsSection
      title="Alertas de presupuesto"
      footer="Te avisamos cuando una categoría cruza cada % marcado de su límite."
    >
      <div className={GROUP}>
        {percents.map((p) => {
          // La marca cambia al tocar (como iOS); si el guardado falla, vuelve sola.
          const saved = alerts.some((a) => a.percent === p)
          const on = pending === p ? !saved : saved
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              aria-busy={pending === p || undefined}
              onClick={() => toggle(p)}
              className={ROW}
            >
              <span className="tabular flex-1">{p}%</span>
              {on && (
                <Check
                  aria-hidden
                  className="size-5 shrink-0 text-primary"
                  strokeWidth={2.5}
                />
              )}
            </button>
          )
        })}
      </div>
    </SettingsSection>
  )
}
