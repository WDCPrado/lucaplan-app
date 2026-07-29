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

// Hosts de los push services reales (dominio base; se aceptan sus subdominios). El endpoint lo
// elige el NAVEGADOR, no el usuario: fuera de esta lista no hay suscripción legítima posible.
// Sin allowlist, cualquiera con sesión haría que el servidor emitiera POSTs contra el host que
// quisiera —incluidos los internos de la red— usando la app como proxy (SSRF).
// Si algún día aparece otro push service, se agrega aquí (y solo aquí).
const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge y Android
  "android.googleapis.com", // GCM heredado
  "push.services.mozilla.com", // Firefox
  "push.apple.com", // Safari en iOS y macOS
  "notify.windows.com", // WNS (Windows)
]

/** ¿El endpoint es de un push service conocido y por HTTPS? Todo lo demás se rechaza. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== "https:") return false
  return PUSH_SERVICE_HOSTS.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
  )
}

export class InvalidPushEndpointError extends Error {
  constructor() {
    super("El endpoint no pertenece a un servicio de notificaciones conocido")
    this.name = "InvalidPushEndpointError"
  }
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
