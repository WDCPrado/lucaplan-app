# Glisse en la app

WDC-173 usa el paquete oficial `glisse@0.5.0`, fijado en el lock. [API y ejemplos](https://glisse.kelvinzhang.ca/) · [código oficial](https://github.com/0kzh/glisse).

| Superficie o control | Implementación |
| --- | --- |
| Barra inferior | TabBar con enlaces de Next; ancho por contenedor y safe areas conservadas |
| Topbar, sidebar, selector de período y aviso PWA | Glass |
| Acciones, acceso, formularios, conexión de correo, onboarding y notificaciones | Button; primarias `filled`, destructivas `destructive`, acciones de icono con `icon` |
| Campos de texto y dinero | Input, con el formateo financiero existente y Controller para React Hook Form |
| Búsqueda de movimientos | SearchField |
| Interruptores | Switch |
| Apariencia y tolerancia de importes | Slider escalar |
| Modo del presupuesto, dirección y filtro de movimientos | SegmentedControl |
| Popovers y menús con portal | Interacción Radix con Glass como superficie |
| Select de formularios y filtros | Trigger Button y panel Glass; selección de valor, typeahead y portal de Radix |
| Selector de mes/ciclo | Trigger, flechas y meses con Button; Popover conserva el portal y el cierre |
| Modales de recurrentes, cuotas y formularios | Glass sobre el mismo nodo de Dialog/Drawer.Content, con posición fixed explícita y token oficial `--lg-surface` |

Se eliminan el hook y los módulos propios de refracción, el segmentado propio y las recetas de material/squish sustituidas. Las clases heredadas `.glass` de las listas son celdas **sólidas**, no otro motor de vidrio.

## Excepciones por contrato

- **Menu:** los dos menús existentes necesitan portal y posicionamiento, o devolver foco antes de abrir otro modal. El menú de cuenta además contiene etiquetas y acciones persistentes. Glisse 0.5 no ofrece portal, colocación superior ni apertura controlada. Se mantiene Radix con superficie Glass.
- **Dialog, Drawer y Select:** se conservan sus interacciones de Radix/Vaul, con superficie y botones Glisse. No existe una API equivalente completa en Glisse. **AlertDialog, Calendar, Tooltip, Toast y OTP** conservan sus controles específicos y superficies de lectura. Las celdas de calendario y filas agrupadas mantienen controles nativos sin una cápsula de vidrio por celda.
- **Rango de importes:** el filtro necesita dos extremos; Glisse Slider sólo tiene un valor. Sigue usando el slider de rango existente.
- **Enlaces con `asChild`:** Button de Glisse es un botón nativo y no ofrece composición como enlace. Los enlaces conservan el primitivo existente; no se anidan enlaces en botones.
- **Filas accionables y chips:** se conservan cuando forman parte de una lista, un calendario o una selección de varias opciones; Glisse no tiene una variante de fila sin superficie ni un grupo de chips equivalente. La landing de marketing no se rediseña.

## Refracción y rendimiento

El contenido de la app es la única fuente `data-glisse-backdrop`. Es hermano de las barras y ocupa también el espacio detrás de la topbar desde el montaje. Glisse coloca sus lentes sobre esa fuente y escribe el filtro directamente: no se clona la página ni se añade un renderer propio. Los diálogos y el onboarding viven en portales fuera de la fuente, para conservar su posición, scroll y foco.

La biblioteca comparte el seguimiento por fuente mediante requestAnimationFrame y cachea los mapas. Se prioriza la refracción completa en Safari, según la elección del usuario; ese seguimiento continuo tiene un coste mayor que el acabado de blur/rim. Las superficies que no se superponen a una fuente, como el sidebar sobre fondo vacío o un portal fuera de AppFrame, mantienen el comportamiento oficial por navegador: refracción de backdrop en Chromium y frost/rim donde no se puede aplicar. No se inventa contenido detrás de ellas.

El CSS oficial se importa estáticamente para el primer render. Glisse también lo inyecta al cargar su módulo cliente; la versión 0.5 no ofrece un mecanismo público para desactivar esa inyección. Se acepta ese duplicado de estilo, sin sentinel privado ni modificaciones del paquete.

## Integración y accesibilidad

- Tema en `class` y `data-theme`, incluido el script inicial y el modo del sistema.
- `glassLevel` y el guardado por usuario siguen intactos; sólo cambia su traducción al token oficial `--lg-glass`.
- El puente CSS adapta objetivos de 44 px, texto de campos de al menos 16 px, el ancho móvil y `aria-invalid`. No modifica la receta de vidrio.
- Menos transparencia o más contraste anulan tanto backdrop-filter de las lentes como el filtro de la fuente. Se conservan las preferencias de movimiento reducido.
- SearchField incluye un botón de borrar con el nombre accesible fijo `Clear`. Glisse 0.5 no expone una prop de traducción; los placeholders y nombres de búsqueda de la app siguen en español. No se manipula el DOM interno para traducirlo.

La preview usa la base demo aislada y el usuario existente `demo@lucaplan.cl` (código `000000`). No se necesita una escena financiera nueva: el cambio sólo sustituye controles y superficies, sin modificar cifras ni contratos de datos.

## Inventario de desplegables

| Uso | Contrato conservado |
| --- | --- |
| Tipo de categoría | Select con valor seleccionado, foco y cambio del formulario |
| Fuente existente, categoría y cuenta de ingreso | Select con valores de dominio, typeahead y portal dentro del formulario |
| Categoría y banco en Movimientos/búsqueda global | Select con selección persistente; ambos buscadores comparten SearchField |
| Menú de cuenta del sidebar | Posición superior, etiquetas y devolución de foco antes de abrir Perfil; Button/Glass oficiales con Radix |
| Menú de cuota en Recurrentes: Editar, Asignar existente y Soltar | Portal fuera del scroll del modal, acciones que abren contenido anidado y bloqueo durante una mutación; Button/Glass oficiales con Radix |
| MonthPicker | Año y mes controlados, cierre al seleccionar; todos sus botones son Glisse |
| Día del mes, fecha de recurrente/cuota, calendario de Inicio, cierre de tarjeta y rango de fechas | Trigger Glisse y panel Glass; day-picker conserva las fechas deshabilitadas, rango y navegación de calendario |

Los sliders de Ajustes, tolerancia de recurrente y tolerancia al asignar una cuota son Glisse. El único slider de dominio que conserva Radix es el rango de dos importes de Movimientos.

Dentro de AppFrame, Dialog/Drawer y los desplegables usan la API pública `container` de sus portales. El host es hermano del contenido dentro de la escena, sin filtro ni transform propio: Glisse puede encontrar la fuente también desde los modales y menús, mientras fixed, scroll y foco siguen gestionados por Radix/Vaul. La búsqueda global y Perfil comparten ese destino.

Fuera de AppFrame (por ejemplo acceso o landing), los portales mantienen el destino predeterminado `body`; sin una fuente que se superponga, Safari usa el acabado oficial frost/rim. No se crea contenido de fondo artificial ni se modifica el motor de Glisse.
