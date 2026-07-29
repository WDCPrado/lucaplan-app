"use client"

import { useEffect } from "react"

// Isla mínima que registra el service worker (fallback offline público y recepción de Web Push;
// ver public/sw.js). Sin registro no hay notificaciones: el push se entrega al SW, no a la página.
// useEffect justificado: sincroniza con el sistema externo navigator.serviceWorker — no existe
// equivalente server-side. updateViaCache: "none" fuerza a revalidar sw.js en cada chequeo.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .catch(() => {
        // best-effort: sin SW la app funciona igual, solo pierde el fallback offline
      })
  }, [])
  return null
}
