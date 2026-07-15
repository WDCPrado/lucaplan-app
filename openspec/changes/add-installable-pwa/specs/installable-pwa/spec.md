## ADDED Requirements

### Requirement: Manifest instalable multiplataforma
La aplicación SHALL exponer un Web App Manifest válido con nombre e identidad de Luca Plan, `id` y `scope` estables, lanzamiento en `/dashboard`, idioma `es-CL` y modo `standalone`. El manifest MUST incluir iconos PNG 192x192 y 512x512 y una variante 512x512 con propósito `maskable`.

#### Scenario: Android reconoce la app como instalable
- **WHEN** un navegador Chromium visita Luca Plan por HTTPS
- **THEN** encuentra un manifest con nombre o short name, iconos 192/512, `start_url`, `scope` y `display: standalone`

#### Scenario: iPhone abre la app instalada
- **WHEN** un usuario agrega Luca Plan a la pantalla de inicio y la abre
- **THEN** se lanza `/dashboard` en una ventana de web app sin la interfaz normal del navegador

### Requirement: Identidad visual de instalación
La aplicación SHALL entregar favicon, Apple Touch Icon, iconos PWA `any` y un icono Android `maskable` derivados de la marca existente. Los iconos SHALL usar fondo opaco, no SHALL hornear la máscara final de esquinas y MUST mantener la marca esencial dentro de la zona segura del 80%.

#### Scenario: Icono Android recibe una máscara circular
- **WHEN** Android aplica una máscara circular o squircle al icono maskable
- **THEN** la “L” completa permanece visible y el fondo de marca llena el contorno

#### Scenario: iOS elige el Apple Touch Icon
- **WHEN** iOS agrega Luca Plan a la pantalla de inicio
- **THEN** usa un Apple Touch Icon PNG nítido con la misma identidad que los iconos del manifest

### Requirement: Apariencia standalone y safe areas
La aplicación SHALL declarar `viewport-fit=cover`, colores de tema compatibles con light/dark y metadata Apple Web App. En modo instalado, el contenido y los controles fijos MUST respetar `safe-area-inset-top`, `safe-area-inset-bottom`, `safe-area-inset-left` y `safe-area-inset-right` sin añadir espacio extra en el navegador normal.

#### Scenario: iPhone con notch en portrait
- **WHEN** la app instalada se abre en un iPhone con notch o Dynamic Island
- **THEN** la cabecera y controles táctiles permanecen dentro del área segura y el fondo cubre toda la pantalla

#### Scenario: Navegador normal conserva el layout
- **WHEN** la misma ruta se abre como pestaña normal
- **THEN** las reglas exclusivas de `display-mode: standalone` no añaden padding de app instalada

### Requirement: Offline seguro
La aplicación SHALL registrar un service worker actualizable que, ante una navegación sin red, muestre una página offline pública. El service worker MUST usar la red como fuente primaria y MUST NOT almacenar respuestas API, documentos autenticados, saldos, movimientos, presupuestos, cookies ni mutaciones.

#### Scenario: Navegación falla sin conexión
- **WHEN** una navegación GET falla por ausencia de red después de instalar el service worker
- **THEN** se muestra el documento offline precacheado en lugar de un error vacío del navegador

#### Scenario: Datos financieros nunca entran al cache
- **WHEN** la app consulta `/api`, carga `/dashboard` o ejecuta una mutación autenticada
- **THEN** el service worker no guarda esa solicitud ni su respuesta en Cache Storage

#### Scenario: Service worker recibe una actualización
- **WHEN** se publica una versión nueva de `sw.js`
- **THEN** el navegador la consulta sin caché HTTP y la versión activa elimina únicamente caches anteriores de Luca Plan

### Requirement: Instalación descubrible
La aplicación SHALL ofrecer una acción contextual de instalación cuando el navegador y estado lo permitan. En navegadores con `beforeinstallprompt`, la acción SHALL abrir el prompt nativo como respuesta directa al usuario. En iOS, donde ese evento no existe, la acción SHALL explicar Compartir y Agregar a inicio. La acción MUST ocultarse en modo standalone o después de `appinstalled`.

#### Scenario: Usuario instala en Android
- **WHEN** Chrome informa que la PWA es instalable y el usuario pulsa “Instalar Luca Plan”
- **THEN** se abre el prompt nativo y la acción desaparece al completar la instalación

#### Scenario: Usuario consulta instalación en iOS
- **WHEN** un usuario de iPhone pulsa “Instalar Luca Plan” fuera de modo standalone
- **THEN** ve instrucciones breves y correctas para agregarla a la pantalla de inicio

#### Scenario: App ya instalada
- **WHEN** Luca Plan corre con `display-mode: standalone`
- **THEN** no muestra la acción ni instrucciones de instalación

