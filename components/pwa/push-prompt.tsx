"use client"

import { useEffect, useState } from "react"
import { BellRing, Loader2 } from "lucide-react"
import { toast } from "sonner"

import {
  DENIED_MESSAGE,
  UNSUPPORTED_MESSAGE,
  enablePush,
  isPushEnabled,
  permissionUndecided,
} from "@/lib/push"
import { haptic } from "@/lib/haptics"
import { Button } from "@/components/ui/button"
import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"

/**
 * Ofrece activar las notificaciones al entrar a la app mientras el dispositivo no las tenga
 * configuradas. Solo aparece si el navegador las soporta y el permiso sigue SIN decidir: una vez
 * concedido o denegado, el navegador ya no vuelve a preguntar y el aviso solo estorbaría (se
 * gestiona desde Configuración).
 *
 * "Ahora no" cierra sin recordar nada: si el dispositivo sigue sin notificaciones, se vuelve a
 * ofrecer la próxima vez que entre.
 */
export function PushPrompt({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  // useEffect justificado: el estado vive en el navegador (permiso + suscripción del service
  // worker), no en el servidor.
  useEffect(() => {
    // ponytail: en local estorba en cada recarga; el flujo se prueba en preview/producción.
    if (!vapidPublicKey || process.env.NODE_ENV === "development") return
    isPushEnabled()
      .then((enabled) => setOpen(!enabled && permissionUndecided()))
      .catch(() => {})
  }, [vapidPublicKey])

  async function activate() {
    setPending(true)
    const result = await enablePush(vapidPublicKey)
    setPending(false)
    if (result === "unsupported") toast.error(UNSUPPORTED_MESSAGE)
    else if (result === "denied") toast.error(DENIED_MESSAGE)
    else if (result === "error")
      toast.error("No se pudo activar. Inténtalo desde Configuración.")
    else {
      haptic("light")
      toast.success("Notificaciones activadas.")
    }
    setOpen(false)
  }

  return (
    <ResponsiveModal
      className="sm:max-w-md"
      open={open}
      onOpenChange={setOpen}
      title="Activa tus notificaciones"
    >
      {/* Contenido y footer comparten el contenedor con `px-4`: ModalFooter se sangra con `-mx-4`
          para llegar a los bordes, así que fuera de un padre con ese padding sus botones se salen
          de la tarjeta (y el texto queda pegado al borde). Mismo patrón que el resto de modales. */}
      <div className="flex flex-col gap-4 px-4 pt-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
          <BellRing className="size-6 text-primary" />
        </div>
        <p className="text-sm text-muted-foreground">
          Te avisamos en este dispositivo cuando:
        </p>
        <ul className="space-y-2 text-sm">
          <li className="flex gap-2">
            <span aria-hidden>•</span> entra un movimiento nuevo desde tu banco,
          </li>
          <li className="flex gap-2">
            <span aria-hidden>•</span> tu gasto del mes cruza un porcentaje de
            tu presupuesto,
          </li>
          <li className="flex gap-2">
            <span aria-hidden>•</span> se acerca el pago de una recurrente o una
            cuota.
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Puedes cambiarlo cuando quieras en Configuración.
        </p>
        <ModalFooter>
          <Button onClick={activate} disabled={pending} className="h-11 flex-1">
            {pending && <Loader2 className="size-4 animate-spin" />}
            Activar notificaciones
          </Button>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
            className="h-11"
          >
            Ahora no
          </Button>
        </ModalFooter>
      </div>
    </ResponsiveModal>
  )
}
