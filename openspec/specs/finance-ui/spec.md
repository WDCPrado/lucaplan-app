# finance-ui

## Purpose

Experiencia de usuario del dominio financiero de LucaPlan: un app shell mobile-first en ruta
protegida con selector de mes, pestañas Resumen/Presupuestos y bottom nav. Cubre la presentación de
cuentas, saldo/caja activa, totales del mes y movimientos (Resumen); los anillos por categoría con
estado y creación (Presupuestos); el detalle de categoría; y el patrón de creación/edición siempre
en modal (transacción, categoría, presupuesto). Usa los tokens del design-system.

## Requirements

### Requirement: App shell mobile-first con navegación

La UI SHALL vivir en una ruta real protegida (redirige a login sin sesión) y ser mobile-first
(diseñada a ~420px, sin scroll horizontal, targets ≥44px, montos con `font-mono`/`tabular-nums`).
SHALL tener un selector de mes, pestañas Resumen/Presupuestos y un bottom nav. Usa los tokens del
design-system.

#### Scenario: Acceso protegido
- **WHEN** un visitante sin sesión abre la ruta de la app
- **THEN** es redirigido a login

#### Scenario: Cambio de mes
- **WHEN** el usuario cambia el mes en el selector
- **THEN** todas las vistas (resumen, presupuestos, movimientos) reflejan ese mes

### Requirement: Pestaña Resumen

La pestaña Resumen SHALL mostrar la(s) tarjeta(s) de cuenta (banco, tipo, saldo, color), el saldo
bancario/caja activa con opción de ocultar, los totales de ingresos/gastos/presupuestado del mes, y
la lista de movimientos recientes.

#### Scenario: Ver saldo y ocultar
- **WHEN** el usuario toca el ojo del saldo
- **THEN** el monto se oculta/muestra sin recargar

#### Scenario: Movimientos con contexto
- **WHEN** se listan los movimientos
- **THEN** cada uno muestra categoría (icon), descripción, monto con signo/color y el disponible restante de su categoría

### Requirement: Pestaña Presupuestos

La pestaña Presupuestos SHALL mostrar un anillo por categoría con su emoji, color por estado
(`bueno`/`moderado`/`completado`/`excedido`), y "disponible de límite", más la lista de movimientos.
Al final de los anillos SHALL haber un anillo **"+"** para crear una categoría.

#### Scenario: Anillos por estado
- **WHEN** una categoría está al 100% de su límite
- **THEN** su anillo se muestra en el color de `completado`; una en 40% en el de `bueno`

#### Scenario: Anillo "+" para crear
- **WHEN** el usuario toca el anillo "+" al final de la fila
- **THEN** se abre el modal de crear categoría

### Requirement: Crear y editar siempre en modal

Toda creación y edición SHALL ocurrir en un modal (hoja), nunca en una pantalla aparte de
formulario, siguiendo el patrón de la referencia. Esto aplica a transacción, categoría y
presupuesto. Editar una categoría SHALL alcanzarse tocando su anillo/detalle; crear una categoría,
desde el anillo "+".

#### Scenario: Editar categoría desde su anillo
- **WHEN** el usuario toca el anillo de una categoría y elige editar
- **THEN** se abre un modal con nombre, límite, emoji y color precargados; al guardar hace PUT y refresca

#### Scenario: Crear en modal
- **WHEN** el usuario crea una transacción, categoría o presupuesto
- **THEN** lo hace dentro de un modal, y al guardar se cierra y las vistas se actualizan

### Requirement: Agregar transacción

La UI SHALL ofrecer una hoja/modal para crear una transacción: monto con toggle −/+ (gasto/ingreso),
título, fecha, selección de cuenta y chips de categoría; al guardar hace POST y refresca las vistas.

#### Scenario: Guardar un gasto
- **WHEN** el usuario ingresa 20.000, elige gasto, cuenta y categoría "Compras" y guarda
- **THEN** se crea la transacción y las vistas de resumen/presupuestos se actualizan

#### Scenario: Validación de monto
- **WHEN** el usuario intenta guardar con monto 0 o vacío
- **THEN** la UI impide guardar y lo indica

### Requirement: Detalle de categoría

La UI SHALL mostrar el detalle de una categoría: anillo grande, usado/de/disponible y los
movimientos del mes de esa categoría. SHALL permitir editar su límite/presentación (si la escritura
lo cubre).

#### Scenario: Abrir categoría
- **WHEN** el usuario toca una categoría en Presupuestos
- **THEN** ve su usado/de/disponible y los movimientos del mes de esa categoría

### Requirement: Cabecera de Presupuestos con restante por presupuestar

La sección Presupuestos del dashboard SHALL mostrar, arriba de los anillos de categoría, el
límite global del mes con el total asignado y el **restante por presupuestar** como cifra
principal. El límite global SHALL definirse y editarse en un modal shadcn (`ResponsiveModal`) con
money input CLP — nunca en una pantalla aparte ni con primitivos nativos.

#### Scenario: Restante visible con límite global definido

- **WHEN** el mes tiene límite global 500.000 y 380.000 asignados en categorías de gasto
- **THEN** la cabecera muestra 120.000 como restante por presupuestar y "380.000 de 500.000" asignado

#### Scenario: Sin límite global, invitación a definirlo

- **WHEN** el usuario nunca ha definido un límite global
- **THEN** la cabecera muestra una invitación a definir el presupuesto del mes que abre el modal del límite

#### Scenario: Sobre-asignado en alerta

- **WHEN** los límites asignados superan el límite global
- **THEN** el restante se muestra en negativo con color de alerta (destructive), sin bloquear nada

#### Scenario: Editar el límite global

- **WHEN** el usuario abre la edición del límite global, ingresa un monto y guarda
- **THEN** se hace POST del límite del mes, el modal se cierra y la cabecera se actualiza

### Requirement: Modal de categoría con vista previa y campos agrupados

El modal de crear/editar categoría SHALL agrupar sus campos por intención — identidad (nombre +
tipo), presupuesto (límite del mes, solo gasto), apariencia (icono + color) y descripción para la
IA — y SHALL mostrar una **vista previa en vivo** (anillo + icono + color + nombre) tal como la
categoría se verá en Presupuestos. La descripción IA SHALL ser colapsable (cerrada por defecto
salvo que tenga texto). El tipo (gasto/ingreso) NO SHALL ser editable al editar una categoría
existente (cambiar el lado rompería la correspondencia income↔credit / expense↔debit).

#### Scenario: Vista previa refleja la edición

- **WHEN** el usuario cambia nombre, icono o color en el modal
- **THEN** la vista previa se actualiza en vivo con esos valores

#### Scenario: Tipo bloqueado en edición

- **WHEN** el usuario edita una categoría existente
- **THEN** el selector de tipo aparece deshabilitado; al crear, sí es seleccionable

#### Scenario: Descripción colapsada por defecto

- **WHEN** el usuario abre el modal de una categoría sin descripción
- **THEN** la sección de descripción IA aparece colapsada y puede expandirse

### Requirement: Ayuda de restante por presupuestar en el campo límite

Al editar el límite de una categoría de gasto, el modal SHALL mostrar como ayuda el restante por
presupuestar del mes calculado **en vivo** contra el valor en pantalla
(`restante del mes + límite original − límite en pantalla`). Si el resultado queda negativo, la
ayuda SHALL mostrarse en color de alerta sin bloquear el guardado. Sin límite global definido, la
ayuda NO SHALL aparecer.

#### Scenario: Ayuda en vivo al subir el límite

- **WHEN** el restante del mes es 120.000, la categoría tenía límite 60.000 y el usuario escribe 100.000
- **THEN** la ayuda muestra 80.000 restantes (120.000 + 60.000 − 100.000)

#### Scenario: Excedido en alerta sin bloquear

- **WHEN** el valor en pantalla deja el restante negativo
- **THEN** la ayuda pasa a color destructive y el botón Guardar sigue habilitado

### Requirement: Selector de color por paleta de swatches

El modal de categoría SHALL ofrecer el color mediante una paleta curada de swatches (constante en
código, legible en dark y light), reemplazando el `<input type="color">` nativo. Si una categoría
existente tiene un color fuera de la paleta, ese color SHALL mostrarse como swatch adicional
seleccionado (no se pierde al editar).

#### Scenario: Elegir color de la paleta

- **WHEN** el usuario toca un swatch
- **THEN** queda seleccionado (indicador visible) y la vista previa adopta el color

#### Scenario: Color legacy fuera de paleta

- **WHEN** se edita una categoría cuyo color no está en la paleta
- **THEN** su color aparece como swatch extra seleccionado y se conserva si no se cambia
