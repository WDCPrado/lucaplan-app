# Diseño de Luca Plan

La fuente canónica del sistema es [docs/design/design-system.md](docs/design/design-system.md)
y sus tokens viven en [app/globals.css](app/globals.css).

El Home aprobado usa blanco/slate y azul con superficies sólidas. Móvil manda: 20 px
laterales, 32 px entre secciones, controles táctiles de 44 px y scroll natural. El resumen
abre con Libre hoy; categorías, actividad y cuentas siguen en ese orden. En escritorio,
las categorías forman una tabla y la actividad ocupa la columna derecha. Las cuentas
mantienen CLP y USD separados. La landing conserva su dirección independiente.

Se conservan Geist para UI, Space Grotesk para títulos y Geist Mono para datos, así como
los tokens emparejados de tema claro/oscuro. El color acompaña texto, signos y estados.

La implementación fue revisada en código y verificada sin navegador. La revisión visual
manual corresponde a Willy en el entorno local/PR; no se afirma QA visual automático.
