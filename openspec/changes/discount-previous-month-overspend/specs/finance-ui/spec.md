## ADDED Requirements

### Requirement: El plan del mes ofrece el ingreso ya descontado de la deuda

El plan del mes SHALL ofrecer igualar el presupuesto global a `max(0, Σ ingresos activos en CLP −
deuda del mes anterior)`, y el botón de la sugerencia SHALL aplicar exactamente ese número. La
oferta SHALL seguir apareciendo solo cuando el número sugerido difiere del presupuesto vigente del
mes.

Cuando la deuda es mayor a 0, la sugerencia SHALL explicar el descuento nombrando el mes anterior y
el monto por el que se pasó, y la etiqueta del botón NO SHALL prometer igualar al ingreso, porque
el número aplicado ya no es el ingreso.

Cuando la deuda es 0, la sugerencia SHALL comportarse como antes de este cambio: mismo total, mismo
texto y misma etiqueta de botón.

La sugerencia NO SHALL impedir repartir por sobre el total ofrecido: el usuario SHALL poder seguir
asignando de más y verlo como sobre-asignación, igual que hoy.

#### Scenario: El mes anterior cerró excedido

- **WHEN** los ingresos activos suman 1.400.000 y la deuda del mes anterior es 150.000
- **THEN** el plan ofrece 1.250.000 y dice que el mes anterior cerró 150.000 sobre su presupuesto

#### Scenario: Aplicar la sugerencia usa el número descontado

- **WHEN** el usuario aplica una sugerencia de 1.250.000 con ingresos por 1.400.000
- **THEN** el presupuesto global del mes queda en 1.250.000, no en 1.400.000

#### Scenario: Sin deuda el plan se comporta como antes

- **WHEN** la deuda del mes anterior es 0
- **THEN** el plan ofrece la suma de los ingresos activos, con el texto y la etiqueta de siempre, y
  no menciona ningún descuento

#### Scenario: La deuda supera a los ingresos

- **WHEN** los ingresos activos suman 1.400.000 y la deuda del mes anterior es 1.600.000
- **THEN** el total ofrecido es 0 y no un número negativo

#### Scenario: El total ofrecido ya coincide con el presupuesto

- **WHEN** el presupuesto vigente del mes es igual al total ya descontado
- **THEN** no se ofrece ninguna sugerencia, aunque los ingresos por sí solos sumen otra cosa

#### Scenario: Repartir por sobre el total ofrecido sigue siendo posible

- **WHEN** el usuario asigna a las categorías más de lo que el plan ofrece
- **THEN** la app lo muestra como sobre-asignación y NO SHALL impedir la operación
