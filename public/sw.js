// Service worker de Luca Plan — deliberadamente mínimo y network-first, más la recepción de
// Web Push (docs/push-notifications.md).
// POLÍTICA DE SEGURIDAD: la app maneja datos financieros autenticados; Cache Storage NUNCA
// guarda respuestas de navegación, HTML autenticado ni nada de /api. El único contenido
// cacheado es el fallback offline PÚBLICO precacheado en install (allowlist de un elemento).
const CACHE = "lucaplan-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// --- Web Push ---
// El payload llega cifrado y se descifra aquí; NO se guarda en Cache Storage (dato financiero).
// Sin payload legible igual se muestra algo: iOS exige que todo push visible muestre notificación,
// o el sistema revoca el permiso a la PWA.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // payload no-JSON: se ignora y cae al texto por defecto
  }
  const title = data.title || "Luca Plan";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // tag colapsa avisos del mismo tipo (no se apilan 8 "nuevo gasto" en la pantalla).
      tag: data.tag || "lucaplan",
      // ...pero reemplazar en silencio parece "no me avisó": renotify vuelve a sonar/vibrar.
      renotify: true,
      data: { url: data.url || "/dashboard" },
    })
  );
});

// Tap en la notificación: reusa la ventana de la PWA si ya está abierta; si no, abre una.
// SIEMPRE navega a la URL del aviso (no basta con enfocar): los avisos enlazan a destinos concretos
// —`/dashboard?tx=<id>` abre ese movimiento— y una ventana ya parada en /dashboard no mostraría
// nada. `navigate` puede fallar (ventana de otro contexto): ahí se abre una nueva.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";
  const target = new URL(url, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const open = clients[0];
        if (!open) return self.clients.openWindow(target);
        if (open.url === target) return open.focus(); // ya está exactamente ahí
        return open
          .navigate(target)
          .then((c) => (c || open).focus())
          .catch(() => self.clients.openWindow(target));
      })
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Solo navegaciones GET; /api, mutaciones y assets pasan directo a la red sin intercepción.
  if (request.method !== "GET" || request.mode !== "navigate") return;
  if (new URL(request.url).pathname.startsWith("/api")) return;
  event.respondWith(
    // Red primero, sin guardar la respuesta; sin red → fallback offline público.
    fetch(request).catch(() => caches.match(OFFLINE_URL))
  );
});
