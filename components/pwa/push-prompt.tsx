"use client"

import { useEffect, useState } from "react"
import { BellRing } from "lucide-react"
import { toast } from "sonner"

import {
  DENIED_MESSAGE,
  UNSUPPORTED_MESSAGE,
  enablePush,
  isPushEnabled,
  permissionUndecided,
} from "@/lib/push"
import { haptic } from "@/lib/haptics"
import { ModalActions, ResponsiveModal } from "@/components/ui/responsive-modal"
import { IconTile } from "@/components/finance/blocks"

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
      {/* Contenido y pie de escritorio comparten el contenedor con `px-4`: el pie se sangra con
          `-mx-4` para llegar a los bordes. En móvil las acciones van en el encabezado. */}
      <div className="flex flex-col gap-4 px-4 pt-2 md:px-6">
        <div className="flex items-center gap-3">
          <IconTile color="var(--primary)">
            <BellRing />
          </IconTile>
          <p className="text-ink-2">Te avisamos en este dispositivo cuando:</p>
        </div>
        <ul className="flex flex-col gap-2 rounded-lg bg-secondary px-4 py-3 text-callout">
          <li>Entra un movimiento nuevo desde tu banco.</li>
          <li>Tu gasto del mes cruza un porcentaje de tu presupuesto.</li>
          <li>Se acerca el pago de una recurrente o una cuota.</li>
        </ul>
        <p className="text-caption text-ink-3">
          Puedes cambiarlo cuando quieras en Configuración.
        </p>
        <ModalActions
          cancel={{
            label: "Ahora no",
            onClick: () => setOpen(false),
            disabled: pending,
          }}
          primary={{
            label: "Activar",
            plain: true,
            busy: pending,
            onClick: activate,
            disabled: pending,
          }}
        />
      </div>
    </ResponsiveModal>
  )
}
