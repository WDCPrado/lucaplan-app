## 1. Identidad y manifest

- [ ] 1.1 Crear una definición determinista del icono “L” y generar/revisar PNG 32, 180, 192, 512 y 512 maskable con fondo opaco y zona segura correcta
- [ ] 1.2 Añadir `app/manifest.ts` con identidad, `/dashboard` como inicio, scope, standalone, colores, idioma e iconos requeridos
- [ ] 1.3 Añadir favicon/Apple Touch Icon y metadata/viewport light-dark con `viewport-fit=cover` en el layout raíz

## 2. Standalone y offline seguro

- [ ] 2.1 Aplicar safe areas solo en modo standalone al lienzo, cabecera móvil, contenido y FAB sin cambiar el layout normal
- [ ] 2.2 Crear el documento offline público y un `public/sw.js` network-first que solo cachee ese fallback y nunca respuestas privadas
- [ ] 2.3 Registrar el service worker desde una isla cliente mínima y configurar headers no-store/CSP específicos para `/sw.js`

## 3. Instalación contextual

- [ ] 3.1 Implementar la acción de instalación con `beforeinstallprompt`, detección iOS/iPadOS, `appinstalled` y ocultamiento en standalone
- [ ] 3.2 Integrar “Instalar Luca Plan” en el menú de usuario y mostrar instrucciones iOS en una superficie responsive existente

## 4. Verificación

- [ ] 4.1 Añadir un único check ejecutable para manifest, dimensiones de iconos y la allowlist offline del service worker
- [ ] 4.2 Ejecutar lint, typecheck, check del service worker y build de producción sin errores
- [ ] 4.3 Verificar en Chromium por HTTPS: manifest válido, prompt, icono maskable, lanzamiento standalone y fallback sin red
- [ ] 4.4 Verificar en iPhone físico por HTTPS: Apple Touch Icon, Agregar a inicio, sesión conservada, ventana standalone, light/dark y safe areas en portrait/landscape

