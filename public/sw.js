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
  // Sin payload legible no hay qué decir: se nombra la app y se invita a abrirla, sin inventar.
  const title = data.title || "Luca Plan";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Tienes un aviso nuevo. Ábrelo para ver el detalle.",
      lang: "es-CL",
      // Ícono a color: el que se ve junto al texto (Android, Windows). iOS usa el de la app.
      icon: "/icons/icon-192.png",
      // Badge de la barra de estado de Android: el sistema usa SOLO su canal alfa y lo pinta de
      // blanco. Con el ícono a color (opaco entero) se veía un cuadrado blanco; este es la "L"
      // sola sobre transparente.
      badge: "/icons/badge-96.png",
      // tag colapsa avisos del mismo tipo (no se apilan 8 "nuevo gasto" en la pantalla).
      tag: data.tag || "lucaplan",
      // ...pero reemplazar en silencio parece "no me avisó": renotify vuelve a sonar/vibrar.
      renotify: true,
      data: { url: data.url || "/dashboard" },
    })
  );
});

// Tap en la notificación: lleva a la URL del aviso (`/dashboard?tx=<id>` abre ese movimiento), en
// la ventana de la PWA si ya está abierta o en una nueva si no.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";
  // Solo destinos de la propia app: una url de otro origen en el payload cae al dashboard.
  const resolved = new URL(url, self.location.origin);
  const target =
    resolved.origin === self.location.origin
      ? resolved.href
      : new URL("/dashboard", self.location.origin).href;
  event.waitUntil(openTarget(target));
});

async function openTarget(target) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open =
    windows.find((c) => c.focused) ||
    windows.find((c) => c.visibilityState === "visible") ||
    windows[0];
  if (!open) {
    const opened = await self.clients.openWindow(target);
    // iOS a veces abre la PWA en su start_url y no en la URL pedida: se corrige si se puede.
    if (opened && opened.url !== target) await opened.navigate(target).catch(() => opened.postMessage({ type: "navigate", url: target }));
    return;
  }
  // Enfocar ANTES de navegar: el permiso para traer una ventana al frente dura poco después del
  // toque, y esperar al navigate (el render del Inicio) lo agotaba: la ventana navegaba de fondo
  // sin aparecer y el openWindow de respaldo también se rechazaba.
  const win = (await open.focus().catch(() => null)) || open;
  if (win.url === target) return; // ya está exactamente ahí
  // `navigate` falla en iOS con la PWA abierta (WebKit 263687) y con ventanas que este SW no
  // controla; ahí navega la propia página (ServiceWorkerRegistration escucha el mensaje). No se
  // abre otra ventana: en iOS openWindow solo enfoca la PWA, sin moverla de pantalla.
  await win.navigate(target).catch(() => win.postMessage({ type: "navigate", url: target }));
}

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
