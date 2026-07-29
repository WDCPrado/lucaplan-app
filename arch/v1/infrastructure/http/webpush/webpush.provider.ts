// Adapter de envío Web Push (RFC 8291 + VAPID) sobre la librería `web-push`, que hace el cifrado
// del payload y la firma VAPID. Implementa el port `PushSender`.
//
// Best-effort como el resto de integraciones externas: sin claves VAPID configuradas no lanza,
// solo devuelve "failed" ⇒ la app funciona igual, simplemente no notifica. El 404/410 del push
// service ("gone") sí se distingue: significa suscripción muerta y el use-case la borra.
import webpush from "web-push"
import type {
  PushMessage,
  PushSender,
  PushSendResult,
  PushSubscription,
} from "../../../domain/notifications/push.domain.ts"

const TTL_SECONDS = 6 * 60 * 60 // si el aparato está apagado más de 6h, el aviso ya no sirve

// `mailto:` es el contacto que exige VAPID para que el push service pueda reportar abusos.
const subject = process.env.VAPID_SUBJECT ?? "mailto:soporte@lucaplan.app"
const publicKey = process.env.VAPID_PUBLIC_KEY ?? ""
const privateKey = process.env.VAPID_PRIVATE_KEY ?? ""

/** Hay claves VAPID: sin esto no se puede enviar nada (ni ofrecer el alta en la UI). */
export function webpushConfigured(): boolean {
  return publicKey.length > 0 && privateKey.length > 0
}

if (webpushConfigured()) webpush.setVapidDetails(subject, publicKey, privateKey)

export const webpushSender: PushSender = {
  async send(
    sub: PushSubscription,
    message: PushMessage
  ): Promise<PushSendResult> {
    if (!webpushConfigured()) return "failed"
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(message),
        { TTL: TTL_SECONDS, urgency: "normal" }
      )
      return "sent"
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) return "gone"
      console.error("[push] envío fallido:", status ?? (e as Error).name)
      return "failed"
    }
  },
}
