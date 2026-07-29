import type {
  PushMessage,
  PushSubscription,
  PushSubscriptionRepository,
  PushSender,
} from "../../domain/notifications/push.domain.ts"

export type PushDeps = {
  subscriptions: PushSubscriptionRepository
  sender: PushSender
}

/** Alta del dispositivo actual. Idempotente: re-suscribirse actualiza las claves del mismo endpoint. */
export async function subscribeToPush(
  deps: PushDeps,
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } }
): Promise<void> {
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
  const subs = await deps.subscriptions.listByUser(userId)
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
