// Web Push (RFC 8030/8291): el navegador entrega una suscripción por dispositivo — un endpoint
// del push service (FCM en Android/Chrome, WNS en Windows/Edge, Apple Push en iOS) más dos claves
// con las que se cifra el payload de extremo a extremo. El servidor solo guarda eso: NADA del
// contenido de la notificación se persiste.
//
// Una suscripción MUERE sola (el navegador la renueva, el usuario desinstala la PWA). El push
// service lo avisa con 404/410 → `gone`, y esa fila se borra. Cualquier otro fallo es transitorio.

export type PushSubscription = {
  userId: string
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Payload que viaja cifrado al dispositivo. `url` es la ruta que abre el tap; `tag` colapsa repetidas. */
export type PushMessage = {
  title: string
  body: string
  url?: string
  tag?: string
}

export type PushSendResult = "sent" | "gone" | "failed"

export interface PushSubscriptionRepository {
  /** Alta idempotente por endpoint: re-suscribir el mismo dispositivo actualiza sus claves. */
  save(sub: PushSubscription): Promise<void>
  // `userId` acota el borrado al dueño (baja pedida desde la app); sin él borra por endpoint, que
  // es lo que corresponde cuando el push service declara la suscripción muerta.
  deleteByEndpoint(endpoint: string, userId?: string): Promise<void>
  listByUser(userId: string): Promise<PushSubscription[]>
}

export interface PushSender {
  send(sub: PushSubscription, message: PushMessage): Promise<PushSendResult>
}
