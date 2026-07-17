# Delta: finance-ui

## MODIFIED Requirements

### Requirement: Detalle de categoría

La UI SHALL mostrar el detalle de una categoría: anillo grande, usado/de/disponible y los
movimientos del mes de esa categoría. SHALL permitir editar su límite/presentación (si la escritura
lo cubre). En escritorio, la cabecera del detalle (anillo, cifras y botón Editar) SHALL permanecer
fija y solo la lista de movimientos SHALL hacer scroll, usando el primitivo `ScrollArea` de shadcn
(no el overflow nativo del contenedor del modal).

#### Scenario: Abrir categoría

- **WHEN** el usuario toca una categoría en Presupuestos
- **THEN** ve su usado/de/disponible y los movimientos del mes de esa categoría

#### Scenario: Scroll solo en la lista (escritorio)

- **WHEN** el usuario abre en escritorio una categoría con más movimientos de los que caben
- **THEN** el anillo y las cifras permanecen visibles mientras la lista de movimientos scrollea dentro de su propia área

## ADDED Requirements

### Requirement: Categoría del movimiento primero en los chips

El chip de la categoría ya asignada al movimiento SHALL aparecer **primero** en la lista
horizontal de categorías del modal de movimiento (edición y detalle de movimiento conectado). El
orden SHALL ser estable durante la sesión del modal (cambiar la selección en pantalla NO SHALL
reordenar los chips).

#### Scenario: Movimiento categorizado

- **WHEN** el usuario abre un movimiento cuya categoría es "Viajes" (creada última)
- **THEN** el chip "Viajes" aparece primero en la lista, ya seleccionado y visible sin scroll

#### Scenario: Orden estable al cambiar selección

- **WHEN** el usuario toca otro chip dentro del modal
- **THEN** la selección cambia pero los chips no se reordenan hasta reabrir el modal
