# Diseño de Luca Plan

La fuente canónica del sistema es [docs/design/design-system.md](docs/design/design-system.md)
y sus tokens viven en [app/globals.css](app/globals.css).

El Home recupera la distribución de `d090ab5`, anterior al rediseño del PR #56:
resumen de presupuesto con Libre hoy y la curva de gasto contra el ritmo, categorías y actividad en
columnas en escritorio, y cuentas con arte en el carrusel inferior. En móvil se
conservan los botones superiores flotantes y la navegación inferior.

Los modales mantienen las mejoras del PR #56: superficies sólidas, altura adaptada
al contenido, formularios validados e identidad por instancia. Un modal hijo se
cierra sin cerrar el padre; el foco vuelve al control que lo abrió. La creación de
cuentas, el plan, ingresos, categorías y la búsqueda conservan esa composición.

Se mantienen los tokens de tema claro/oscuro, las fuentes del sistema y la
separación entre CLP y USD. La landing conserva su dirección independiente.
