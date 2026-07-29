"use client"

import { useEffect, useState } from "react"
import { BellRing, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { haptic } from "@/lib/haptics"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

// La clave pública VAPID viaja en base64url y el navegador la pide como bytes crudos.
// El ArrayBuffer explícito es por tipos: `applicationServerKey` no acepta un buffer compartido.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/")
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

const supported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  // null = todavía consultando al service worker.
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)

  // useEffect justificado: lee el estado real de la suscripción en el navegador (sistema externo,
  // sin equivalente en el servidor — cada dispositivo tiene la suya).
  useEffect(() => {
    const current = supported()
      ? navigator.serviceWorker.ready
          .then((reg) => reg.pushManager.getSubscription())
          .then(Boolean)
      : Promise.resolve(false)
    current.then(setEnabled).catch(() => setEnabled(false))
  }, [])

  async function toggle(next: boolean) {
    if (!supported()) {
      toast.error(
        "Este navegador no permite notificaciones. En iPhone o iPad: Compartir → Añadir a pantalla de inicio, y abre la app desde ahí."
      )
      return
    }
    setPending(true)
    try {
      const reg = await navigator.serviceWorker.ready
      if (next) {
        // El permiso DEBE pedirse dentro del gesto del usuario (este click); si no, iOS lo ignora.
        const permission = await Notification.requestPermission()
        if (permission !== "granted") {
          toast.error(
            "Permiso denegado. Actívalo en los ajustes de notificaciones del navegador."
          )
          return
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        })
        const res = await fetch("/api/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        })
        if (!res.ok) throw new Error("alta rechazada")
        setEnabled(true)
        haptic("light")
        toast.success("Notificaciones activadas.")
      } else {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await fetch("/api/push", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          })
          await sub.unsubscribe()
        }
        setEnabled(false)
        toast.success("Notificaciones desactivadas.")
      }
    } catch {
      toast.error("No se pudo cambiar las notificaciones. Inténtalo de nuevo.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label
          htmlFor="push"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <BellRing className="size-4 text-muted-foreground" />
          Avisos en este dispositivo
        </Label>
        <p className="text-xs text-muted-foreground">
          Movimientos nuevos de tu banco, alertas de presupuesto y pagos por
          vencer. En iPhone o iPad necesitas abrir la app desde la pantalla de
          inicio.
        </p>
      </div>
      <div className="flex h-11 items-center">
        {pending || enabled === null ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <Switch
            id="push"
            checked={enabled}
            onCheckedChange={toggle}
            aria-label="Activar notificaciones en este dispositivo"
          />
        )}
      </div>
    </div>
  )
}
