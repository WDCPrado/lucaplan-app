# Diseño de Luca Plan

La fuente canónica del sistema es [docs/design/design-system.md](docs/design/design-system.md)
y sus tokens viven en [app/globals.css](app/globals.css).

El Home aprobado usa blanco/slate y azul con superficies sólidas. Móvil manda: 20 px
laterales, 32 px entre secciones, controles táctiles de 44 px y scroll natural. El resumen
abre con Libre hoy; categorías, actividad y cuentas siguen en ese orden. Inicio móvil usa dos
filas de encabezado que scrollean: marca, búsqueda y avatar arriba; título y mes debajo.
El ciclo de crédito reúne rango, cierre y edición en una superficie de dos líneas. El resumen
mantiene Ajustar plan junto a Libre hoy, tres totales cuando caben y presupuesto/por repartir
como texto secundario bajo el progreso, sin repetir la acción del plan. A 320 px los totales
pueden pasar a dos columnas. En escritorio,
las categorías ocupan dos tercios y la actividad una columna de al menos 340 px. La tabla
Categoría/Gastado/Comprometido/Disponible/Avance aparece con 680 px reales de contenedor;
antes conserva filas. El resumen se vuelve horizontal con 900 px disponibles, con el
progreso de gastado y comprometido al centro. El selector del ciclo conserva barras de gasto por día
y número de fecha, con hoy destacado y navegación por teclado. Las cuentas
mantienen CLP y USD separados. La landing conserva su dirección independiente.

Se conservan Geist para UI, Space Grotesk para títulos y cifras sans tabulares en el resumen y la tabla; Geist Mono para otros datos, así como
los tokens emparejados de tema claro/oscuro. El color acompaña texto, signos y estados.

La implementación fue revisada en código y verificada sin navegador. La revisión visual
manual corresponde a Willy en el entorno local/PR; no se afirma QA visual automático.
