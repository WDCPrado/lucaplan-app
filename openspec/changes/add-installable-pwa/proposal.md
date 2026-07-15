## Why

Luca Plan hoy funciona bien en el navegador, pero no se identifica ni se instala como aplicación en iPhone o Android. Convertirla en una PWA instalable permite abrirla desde la pantalla de inicio en una ventana propia, con identidad visual consistente y una experiencia móvil más cercana a una app nativa sin mantener dos aplicaciones separadas.

## What Changes

- Añadir un Web App Manifest nativo de Next.js 16 con identidad estable, lanzamiento en `/dashboard`, modo `standalone`, alcance propio, colores de marca e iconos para iOS y Android.
- Crear iconos PNG de Luca Plan para favicon, Apple Touch Icon, tamaños PWA 192/512 y variante maskable de Android, manteniendo la marca existente.
- Añadir metadatos y viewport específicos para instalación, tema claro/oscuro y safe areas de iPhone.
- Registrar un service worker mínimo con actualización segura y una pantalla offline pública; no almacenar saldos, movimientos, respuestas de API ni HTML autenticado.
- Ajustar el shell móvil para respetar notch, barra de estado y home indicator cuando corre en modo instalado.
- Ofrecer una acción de instalación contextual: prompt nativo donde el navegador lo permite e instrucciones de “Agregar a inicio” en iOS, sin mostrarla cuando la app ya está instalada.
- Añadir headers seguros para el service worker y validaciones automatizadas del manifest, assets y reglas de caché.

## Capabilities

### New Capabilities

- `installable-pwa`: Instalación, identidad visual, lanzamiento standalone, experiencia offline segura y descubrimiento de instalación en plataformas compatibles.

### Modified Capabilities

- `app-shell`: El shell móvil debe respetar las safe areas del dispositivo y ofrecer la instalación sin interferir con la navegación ni los controles financieros.

## Impact

- Afecta metadatos y viewport del App Router, assets públicos, estilos globales, configuración de headers, el shell autenticado y una superficie pequeña de ayuda de instalación.
- No cambia APIs financieras, modelo de datos, autenticación ni rutas existentes.
- No añade dependencias: se usan APIs nativas de Next.js, Web App Manifest, Service Worker y CSS `env()`/`display-mode`.
- El contenido financiero autenticado permanece network-only y nunca se persiste en Cache Storage.
