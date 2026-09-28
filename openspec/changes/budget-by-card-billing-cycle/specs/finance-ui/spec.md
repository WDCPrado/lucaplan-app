## ADDED Requirements

### Requirement: Switch de modo en el Inicio

El Inicio SHALL mostrar un switch para alternar entre **Modo débito** y **Modo tarjeta de
crédito**, con una etiqueta que diga el modo activo. Cambiarlo SHALL guardar el modo y recargar
los números del mes con el nuevo rango. El switch SHALL ser un `Switch` de shadcn, con su label
asociado y un target táctil de al menos 44 px en móvil.

#### Scenario: Activar modo tarjeta después del cierre

- **WHEN** hoy es 28/09/2026 y el usuario activa el modo tarjeta
- **THEN** el Inicio pasa a mostrar octubre 2026 con el rango 23 sep – 22 oct y los gastos desde
  el 23/09

#### Scenario: Error al guardar

- **WHEN** falla el guardado del modo
- **THEN** el switch vuelve a su valor anterior y se avisa con un toast

### Requirement: Rango y cierre del ciclo visibles y corregibles

En modo tarjeta, el Inicio SHALL mostrar el rango del mes (por ejemplo «23 sep – 22 oct») y la
fecha de cierre, marcada como «estimado» cuando no hay corrección. Tocar el cierre SHALL abrir un
Calendar dentro de un Popover, limitado a los días del mes, para corregirlo. El Popover SHALL
ofrecer «Usar estimado» cuando hay corrección guardada.

En modo débito NO SHALL mostrarse ni el rango ni el cierre.

#### Scenario: Corregir el cierre

- **WHEN** el cierre de octubre está estimado en 22/10 y el usuario elige 21/10 en el calendario
- **THEN** el rango pasa a «23 sep – 21 oct», desaparece la marca «estimado» y los números se
  recalculan

### Requirement: Tira de días del ciclo

La tira de días del Inicio SHALL mostrar un día por cada fecha del rango del mes, en orden, aunque
el rango cruce dos meses calendario. El gasto de cada día SHALL agruparse por fecha y no por número
de día del mes.

#### Scenario: Ciclo que cruza meses

- **WHEN** el mes es octubre 2026 en modo tarjeta (23/09 → 22/10)
- **THEN** la tira va del 23 sep al 22 oct, y un gasto del 25/09 y otro del 25/10 no se mezclan
