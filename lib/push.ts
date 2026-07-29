"use client"

// Alta y baja de Web Push desde el navegador. Vive aquí (no en un componente) porque lo comparten
// el control de Configuración y el aviso que se ofrece al entrar a la app.

// La clave pública VAPID viaja en base64url y el navegador la pide como bytes crudos.
// El ArrayBuffer explícito es por tipos: `applicationServerKey` no acepta un buffer compartido.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/")
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** En iOS solo es true dentro de la PWA instalada; en una pestaña de Safari no existe PushManager. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

/** ¿Este dispositivo ya está suscrito? `false` también cuando el navegador no soporta push. */
export async function isPushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.ready
  return Boolean(await reg.pushManager.getSubscription())
}

/** El usuario aún no decidió: ni concedió ni negó el permiso. Es a quien tiene sentido preguntarle. */
export function permissionUndecided(): boolean {
  return pushSupported() && Notification.permission === "default"
}

export type EnableResult = "ok" | "unsupported" | "denied" | "error"

/**
 * Pide permiso y registra el dispositivo. DEBE invocarse dentro del gesto del usuario (un click):
 * fuera de él, iOS ignora la petición de permiso.
 */
export async function enablePush(vapidPublicKey: string): Promise<EnableResult> {
  if (!pushSupported()) return "unsupported"
  try {
    const reg = await navigator.serviceWorker.ready
    if ((await Notification.requestPermission()) !== "granted") return "denied"
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    })
    const res = await fetch("/api/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    })
    return res.ok ? "ok" : "error"
  } catch {
    return "error"
  }
}

/** Da de baja este dispositivo (servidor y navegador). */
export async function disablePush(): Promise<boolean> {
  if (!pushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await fetch("/api/push", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      })
      await sub.unsubscribe()
    }
    return true
  } catch {
    return false
  }
}

export const UNSUPPORTED_MESSAGE =
  "Este navegador no permite notificaciones. En iPhone o iPad: Compartir → Añadir a pantalla de inicio, y abre la app desde ahí."
export const DENIED_MESSAGE =
  "Permiso denegado. Actívalo en los ajustes de notificaciones del navegador."
