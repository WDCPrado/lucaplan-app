"use client"

import { Button } from "glisse"

import { useEffect, useState } from "react"
import { BellOff, BellRing, Check, Loader2 } from "lucide-react"
import { toast } from "sonner"

import {
  DENIED_MESSAGE,
  UNSUPPORTED_MESSAGE,
  disablePush,
  enablePush,
  isPushEnabled,
} from "@/lib/push"
import { haptic } from "@/lib/haptics"

/** Botón de alta/baja de notificaciones en este dispositivo (Configuración → Notificaciones). */
export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
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
    if (enabled) {
      const ok = await disablePush()
      setPending(false)
      if (!ok) {
        toast.error("No se pudo desactivar. Inténtalo de nuevo.")
        return
      }
      setEnabled(false)
      toast.success("Notificaciones desactivadas.")
      return
    }

    const result = await enablePush(vapidPublicKey)
    setPending(false)
    if (result === "unsupported") return toast.error(UNSUPPORTED_MESSAGE)
    if (result === "denied") return toast.error(DENIED_MESSAGE)
    if (result === "error")
      return toast.error("No se pudo activar. Inténtalo de nuevo.")
    setEnabled(true)
    haptic("light")
    toast.success("Notificaciones activadas.")
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BellRing className="size-4 text-muted-foreground" />
          Avisos en este dispositivo
          {enabled && (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-success">
              <Check className="size-3.5" />
              Activados
            </span>
          )}
        </div>
        <p className="max-w-prose text-xs text-muted-foreground">
          Movimientos nuevos de tu banco, alertas de presupuesto y pagos por
          vencer. En iPhone o iPad necesitas abrir la app desde la pantalla de
          inicio.
        </p>
      </div>
      <Button
        onClick={toggle}
        disabled={pending || enabled === null}
        variant={enabled ? "glass" : "filled"}
        className="h-11"
      >
        {pending || enabled === null ? (
          <Loader2 className="size-4 animate-spin" />
        ) : enabled ? (
          <BellOff className="size-4" />
        ) : (
          <BellRing className="size-4" />
        )}
        {enabled ? "Desactivar" : "Activar notificaciones"}
      </Button>
    </div>
  )
}
