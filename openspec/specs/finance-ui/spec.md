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
