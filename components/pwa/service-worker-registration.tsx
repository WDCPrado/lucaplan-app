"use client";

import { useEffect } from "react";

// Isla mínima que registra el service worker (fallback offline público; ver public/sw.js).
// useEffect justificado: sincroniza con el sistema externo navigator.serviceWorker — no existe
// equivalente server-side. updateViaCache: "none" fuerza a revalidar sw.js en cada chequeo.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {
      // best-effort: sin SW la app funciona igual, solo pierde el fallback offline
    });
  }, []);
  return null;
}
