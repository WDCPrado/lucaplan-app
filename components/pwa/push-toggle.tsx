"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import {
  DENIED_MESSAGE,
  UNSUPPORTED_MESSAGE,
  disablePush,
  enablePush,
  isPushEnabled,
} from "@/lib/push"
import { haptic } from "@/lib/haptics"
import { Switch } from "@/components/ui/switch"

/**
 * Fila con switch para el alta/baja de notificaciones en este dispositivo (Ajustes →
 * Notificaciones). El switch ya dice el estado: solo los errores llevan toast.
 */
export function PushToggle({
  vapidPublicKey,
  className,
  describedBy,
}: {
  vapidPublicKey: string
  className?: string
  describedBy?: string
}) {
  // null = todavía consultando al service worker.
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)

  // useEffect justificado: lee el estado real de la suscripción en el navegador (sistema externo,
  // sin equivalente en el servidor — cada dispositivo tiene la suya).
  useEffect(() => {
    isPushEnabled().then(setEnabled).catch(() => setEnabled(false))
  }, [])

  async function toggle() {
    setPending(true)
    try {
      if (enabled) {
        if (await disablePush()) setEnabled(false)
        else toast.error("No se pudo desactivar. Inténtalo de nuevo.")
        return
      }
      const result = await enablePush(vapidPublicKey)
      if (result === "unsupported") toast.error(UNSUPPORTED_MESSAGE)
      else if (result === "denied") toast.error(DENIED_MESSAGE)
      else if (result === "error")
        toast.error("No se pudo activar. Inténtalo de nuevo.")
      else {
        setEnabled(true)
        haptic("light")
      }
    } catch {
      toast.error("No se pudo cambiar. Inténtalo de nuevo.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={className}>
      <label htmlFor="settings-push" className="flex-1 text-body">
        Avisos en este dispositivo
      </label>
      {/* Mientras pide permiso, la perilla ya está donde va (como iOS); si falla, vuelve. */}
      <Switch
        id="settings-push"
        checked={pending ? !enabled : !!enabled}
        disabled={pending || enabled === null}
        aria-busy={pending || enabled === null || undefined}
        aria-describedby={describedBy}
        onCheckedChange={toggle}
      />
    </div>
  )
}
