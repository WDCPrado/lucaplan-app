## 1. Identidad y manifest

- [x] 1.1 Crear una definición determinista del icono “L” y generar/revisar PNG 32, 180, 192, 512 y 512 maskable con fondo opaco y zona segura correcta — `scripts/generate-pwa-icons.ts` (PNG escrito a mano con zlib, "L" por SDF sobre el gradiente de marca; sin dependencias) → `public/icons/*`, revisados visualmente
- [x] 1.2 Añadir `app/manifest.ts` con identidad, `/dashboard` como inicio, scope, standalone, colores, idioma e iconos requeridos
- [x] 1.3 Añadir favicon/Apple Touch Icon y metadata/viewport light-dark con `viewport-fit=cover` en el layout raíz (`metadata.icons`, `appleWebApp`, `viewport.themeColor` por esquema)

## 2. Standalone y offline seguro

- [x] 2.1 Aplicar safe areas solo en modo standalone al lienzo, cabecera móvil, contenido y FAB sin cambiar el layout normal (`@media (display-mode: standalone)` + `.pwa-safe-top` con `max()`; el FAB ya usaba `env(safe-area-inset-bottom)`)
- [x] 2.2 Crear el documento offline público (`public/offline.html`) y un `public/sw.js` network-first que solo cachea ese fallback y nunca respuestas privadas (no intercepta `/api` ni requests no-navegación; limpia caches viejos en activate)
- [x] 2.3 Registrar el service worker desde una isla cliente mínima (`components/pwa/service-worker-registration.tsx`, `updateViaCache: "none"`) y configurar headers no-store/CSP específicos para `/sw.js` en `next.config.ts`

## 3. Instalación contextual

- [x] 3.1 Implementar la acción de instalación con `beforeinstallprompt`, detección iOS/iPadOS, `appinstalled` y ocultamiento en standalone (`components/pwa/install-app-item.tsx`; display-mode vía `useSyncExternalStore`)
- [x] 3.2 Integrar “Instalar Luca Plan” en el menú de usuario (sidebar y avatar móvil comparten `UserMenu`) y mostrar instrucciones iOS en `ResponsiveModal` (con `preventDefault` para que el cierre del menú no desmonte el modal)

## 4. Verificación

- [x] 4.1 Añadir un único check ejecutable (`scripts/check-pwa.test.ts`, node --test): manifest coherente, dimensiones reales de los PNG vs declaradas, allowlist del SW (solo `/offline.html`, sin `cache.put`, sin interceptar `/api`)
- [x] 4.2 Ejecutar lint, typecheck, check del service worker y build de producción sin errores
- [x] 4.3 Verificar en Chromium (producción local `next start`): manifest válido servido, headers de `/sw.js` (no-store + CSP), SW activo con scope `/`, **fallback offline real** (red cortada → “Sin conexión · Luca Plan”), Cache Storage con SOLO `/offline.html`, ítem de instalación oculto sin vía disponible y visible con UA iOS mostrando las instrucciones
- [ ] 4.4 Verificar en iPhone físico por HTTPS (lucaplan.cl tras deploy): Apple Touch Icon, Agregar a inicio, sesión conservada, ventana standalone, light/dark y safe areas en portrait/landscape — **pendiente del usuario en su dispositivo**
