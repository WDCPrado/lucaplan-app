import {
  InvalidPushEndpointError,
  isAllowedPushEndpoint,
  type PushMessage,
  type PushSubscription,
  type PushSubscriptionRepository,
  type PushSender,
} from "../../domain/notifications/push.domain.ts"

export type PushDeps = {
  subscriptions: PushSubscriptionRepository
  sender: PushSender
}

/**
 * Alta del dispositivo actual. Idempotente: re-suscribirse actualiza las claves del mismo endpoint.
 *
 * El endpoint se valida contra los push services conocidos ANTES de guardarlo: es una URL que el
 * cliente propone y a la que el servidor hará POST en cada envío. Aceptar cualquiera convertiría a
 * la app en un proxy hacia hosts arbitrarios (SSRF).
 */
export async function subscribeToPush(
  deps: PushDeps,
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<void> {
  if (!isAllowedPushEndpoint(sub.endpoint)) throw new InvalidPushEndpointError()
  await deps.subscriptions.save({ userId, ...sub })
}

/** Baja del dispositivo (el usuario apaga el toggle). Acotada al dueño: nadie da de baja ajena. */
export async function unsubscribeFromPush(
  deps: PushDeps,
  userId: string,
  endpoint: string
): Promise<void> {
  await deps.subscriptions.deleteByEndpoint(endpoint, userId)
}

/**
 * Envía a TODOS los dispositivos del usuario y devuelve cuántos recibieron. Las suscripciones
 * muertas (`gone`) se borran aquí: es el único momento en que el push service las declara así, y
 * dejarlas reintentaría para siempre. Un fallo transitorio no borra nada ni corta a los demás.
 */
export async function sendPushToUser(
  deps: PushDeps,
  userId: string,
  message: PushMessage
): Promise<number> {
  // Segunda barrera: aunque el alta ya valida, nada sale hacia un host que no sea un push service
  // conocido (filas viejas, escrituras directas a la BD, un adapter futuro que se salte el caso de uso).
  const subs = (await deps.subscriptions.listByUser(userId)).filter((s) =>
    isAllowedPushEndpoint(s.endpoint)
  )
  const results = await Promise.all(
    subs.map(async (sub: PushSubscription) => ({
      sub,
      result: await deps.sender.send(sub, message).catch(() => "failed" as const),
    }))
  )
  for (const { sub, result } of results) {
    if (result === "gone") await deps.subscriptions.deleteByEndpoint(sub.endpoint)
  }
  return results.filter((r) => r.result === "sent").length
}
