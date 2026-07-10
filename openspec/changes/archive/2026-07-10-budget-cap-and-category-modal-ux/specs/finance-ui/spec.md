# Delta: finance-ui

## ADDED Requirements

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
