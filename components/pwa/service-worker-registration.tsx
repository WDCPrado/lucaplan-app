"use client"

import { useEffect } from "react"

// Isla mínima que registra el service worker (fallback offline público y recepción de Web Push;
// ver public/sw.js). Sin registro no hay notificaciones: el push se entrega al SW, no a la página.
// useEffect justificado: sincroniza con el sistema externo navigator.serviceWorker — no existe
// equivalente server-side. updateViaCache: "none" fuerza a revalidar sw.js en cada chequeo.
// También escucha el pedido del SW de ir a la URL de una notificación tocada, para cuando el
// navegador no le deja navegar la ventana (iOS con la PWA abierta; ver notificationclick).
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    const sw = navigator.serviceWorker
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "navigate" || typeof event.data.url !== "string") return
      const url = new URL(event.data.url, window.location.origin)
      // Carga completa: el destino se arma en el servidor (`?tx=` resuelve el movimiento allá).
      if (url.origin === window.location.origin) window.location.assign(url.href)
    }
    sw.addEventListener("message", onMessage)
    sw.startMessages()
    sw.register("/sw.js", { updateViaCache: "none" }).catch(() => {
      // best-effort: sin SW la app funciona igual, solo pierde el fallback offline
    })
    return () => sw.removeEventListener("message", onMessage)
  }, [])
  return null
}
