## Context

La app usa Next.js 16.2.6 con App Router, React 19, Tailwind 4, `next-themes` y un shell móvil ya adaptado con `100dvh`, sheets y haptics. No existe manifest, set de iconos PWA, metadata Apple, registro de service worker ni una acción de instalación.

La guía oficial de Next.js, actualizada en 2026, confirma que App Router genera el manifest desde `app/manifest.ts` y que HTTPS más un manifest válido bastan para instalación. Safari 26 abre por defecto cualquier sitio agregado a inicio como web app, pero el manifest sigue controlando identidad, iconos y URL de lanzamiento. Android requiere iconos PNG 192 y 512 para promoción de instalación y usa manifest, color e icono para su splash.

Luca Plan maneja información financiera autenticada. El service worker no puede convertir Cache Storage en una copia local implícita de saldos, movimientos o respuestas privadas.

## Goals / Non-Goals

**Goals:**

- Instalar Luca Plan desde iPhone y Android y abrirla en modo `standalone` desde `/dashboard`.
- Mantener una identidad nítida con iconos Apple, `any` y `maskable` derivados de la marca existente.
- Respetar notch, barra de estado, orientación y home indicator sin alterar la interfaz normal del navegador.
- Dar una salida segura y clara cuando no hay red.
- Hacer descubrible la instalación desde el menú de usuario, con comportamiento específico por capacidad del navegador.
- Mantener el cambio sin dependencias nuevas y con una isla cliente pequeña.

**Non-Goals:**

- Publicar wrappers en App Store o Google Play.
- Añadir push notifications, badges, background sync o acceso a APIs nativas no pedido.
- Hacer que datos financieros sean utilizables offline o cachear HTML autenticado.
- Rediseñar navegación, dashboard, landing o flujos financieros.
- Generar la matriz completa de imágenes propietarias `apple-touch-startup-image`; se usará un fondo inicial coherente y se añadirá esa matriz solo si las pruebas físicas muestran un cold start inaceptable.

## Decisions

### Manifest nativo del App Router

Se creará `app/manifest.ts` tipado con `MetadataRoute.Manifest`. Definirá `id: "/"`, `scope: "/"`, `start_url: "/dashboard"`, `display: "standalone"`, `lang: "es-CL"`, orientación natural, nombre, descripción, colores opacos compatibles e iconos 192/512 más maskable.

Alternativa descartada: manifest JSON manual. La convención nativa de Next reduce wiring y mantiene validación TypeScript.

### Iconos deterministas desde la marca existente

El icono será un cuadrado de fondo azul de marca, sin esquinas redondeadas horneadas, con la “L” geométrica existente centrada. El arte importante quedará dentro del círculo seguro del 80% y la variante maskable tendrá fondo opaco de borde a borde. Se generarán PNG 32, 180, 192 y 512, además de 512 maskable, desde una única definición reproducible.

Alternativa descartada: generación visual por IA. La skill de imagen indica no usarla para extender una marca o icono vectorial existente; un render determinista evita desviaciones de logo, texto borroso y diferencias entre tamaños.

### Metadata y safe areas por plataforma

`app/layout.tsx` exportará `viewport` con `viewportFit: "cover"` y colores `theme-color` separados para light/dark. `metadata.appleWebApp` declarará capacidad, título y estilo de barra compatible. CSS aplicará `env(safe-area-inset-*)` solo en `display-mode: standalone`; los controles fijos conservarán su padding mínimo actual mediante `max()`.

Alternativa descartada: simular una interfaz iOS con componentes Apple. Luca Plan debe conservar su sistema visual y usar convenciones web/táctiles existentes, no imitar controles propietarios.

### Service worker network-first sin caché privada

Un `public/sw.js` nativo precargará únicamente una página estática pública de offline. Solo interceptará navegaciones GET: intentará la red y, ante fallo, servirá el fallback. No interceptará `/api`, mutaciones ni recursos financieros, no guardará respuestas de navegación y borrará caches propios de versiones anteriores durante `activate`.

El registro vivirá en una isla cliente global y usará `updateViaCache: "none"`. Este `useEffect` está justificado porque sincroniza React con el sistema externo `navigator.serviceWorker`; no existe equivalente de Server Component.

Alternativa descartada: Serwist o `next-pwa`. La guía de Next señala que Serwist todavía depende de configuración webpack para offline, mientras esta política requiere una sola página y cabe en APIs nativas.

### Instalación progresiva en el menú de usuario

Una acción “Instalar Luca Plan” se mostrará en el menú de usuario solo cuando no se esté ejecutando como app instalada. En navegadores que emiten `beforeinstallprompt`, conservará el evento y abrirá el prompt desde la acción del usuario. En iPhone/iPad mostrará instrucciones breves para Compartir y Agregar a inicio. El evento `appinstalled` y `display-mode: standalone` ocultarán la acción al completarse.

El listener usa `useEffect` porque `beforeinstallprompt`, `appinstalled` y `matchMedia` son eventos externos del navegador. La UI reutilizará el dropdown y modal responsive existentes.

Alternativa descartada: cambiar el CTA principal de la landing. Eso alteraría conversión y navegación sin necesidad; los navegadores ya promocionan la instalación y el menú ofrece una vía estable dentro de la app.

### Headers limitados al service worker

`next.config.ts` entregará `/sw.js` como JavaScript, sin caché HTTP y con CSP `default-src 'self'; script-src 'self'`. No se añadirán headers globales en este cambio para evitar efectos laterales sobre OAuth, Fintoc o assets externos.

## Risks / Trade-offs

- [iOS no expone un prompt de instalación programable] → Mostrar instrucciones dentro de la app y no prometer que el botón instala por sí solo.
- [El cold start de iOS puede mostrar un fondo del sistema] → Alinear `background_color`, `theme-color` y fondo raíz; añadir startup images por dispositivo solo si una prueba física demuestra que hace falta.
- [Safe areas pueden duplicar espacio en navegador normal] → Activarlas solo bajo `@media (display-mode: standalone)` y verificar portrait/landscape.
- [Un service worker incorrecto puede dejar código obsoleto] → No cachear bundles de Next, servir `sw.js` con `no-store`, usar `updateViaCache: none` y versionar únicamente el cache offline.
- [Cache Storage puede filtrar información sensible] → La allowlist contiene solo el documento offline público; ningún dato autenticado entra al cache.
- [La PWA no equivale a una app nativa completa] → Documentar que instalación web, offline seguro, haptics existentes y shell standalone son el alcance; tiendas y APIs nativas quedan fuera.

## Migration Plan

1. Generar y revisar visualmente los iconos, incluido recorte maskable.
2. Añadir manifest, metadata, viewport, registro y fallback offline.
3. Añadir safe areas y la acción de instalación sin cambiar CTAs existentes.
4. Ejecutar lint, typecheck, build y validación sintáctica del service worker.
5. Verificar manifest e instalación con Lighthouse/DevTools en Chromium y en un iPhone físico por HTTPS.
6. Desplegar normalmente. Para rollback, retirar registro/manifest y publicar un `sw.js` que elimine su cache y se desregistre antes de borrar la ruta.

## Open Questions

Ninguna para este alcance. La publicación en tiendas y las notificaciones requieren cambios separados.

