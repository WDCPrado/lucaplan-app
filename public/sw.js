// Service worker de Luca Plan — deliberadamente mínimo y network-first.
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
