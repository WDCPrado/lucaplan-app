// Alta y baja de la suscripción Web Push del dispositivo actual.
// El alta responde con una notificación de bienvenida: es la prueba de extremo a extremo de que el
// circuito (permiso → service worker → VAPID → push service) funciona en ESE aparato.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import {
  sendPushToUser,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/arch/v1/application/notification-use-cases/push-use-cases"
import { isAllowedPushEndpoint } from "@/arch/v1/domain/notifications/push.domain"
import { pushDeps } from "@/arch/v1/infrastructure/database/prisma/push-deps"

type Body = {
  endpoint?: unknown
  keys?: { p256dh?: unknown; auth?: unknown }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null
  const endpoint = body?.endpoint
  const p256dh = body?.keys?.p256dh
  const auth = body?.keys?.auth
  // Validación en el boundary: sin claves no hay suscripción, y el endpoint debe ser de un push
  // service conocido — es la URL a la que el servidor hará POST en cada envío (el caso de uso lo
  // revalida; aquí se corta antes de tocar la base).
  if (
    typeof endpoint !== "string" ||
    !isAllowedPushEndpoint(endpoint) ||
    typeof p256dh !== "string" ||
    typeof auth !== "string"
  ) {
    return Response.json(
      { error: "suscripción push inválida" },
      { status: 400 }
    )
  }

  return withUser(
    req,
    async (userId) => {
      await subscribeToPush(pushDeps, userId, {
        endpoint,
        keys: { p256dh, auth },
      })
      // `sent` = dispositivos que recibieron el aviso de bienvenida (0 ⇒ VAPID mal configurado).
      const sent = await sendPushToUser(pushDeps, userId, {
        title: "Notificaciones activadas",
        body: "Te avisaremos de tus movimientos y tu presupuesto.",
        url: "/dashboard",
        tag: "welcome",
      })
      return { ok: true, sent }
    },
    201
  )
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null
  const endpoint = body?.endpoint
  if (typeof endpoint !== "string") {
    return Response.json({ error: "endpoint requerido" }, { status: 400 })
  }
  return withUser(req, async (userId) => {
    await unsubscribeFromPush(pushDeps, userId, endpoint)
    return { ok: true }
  })
}
