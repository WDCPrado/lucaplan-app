## ADDED Requirements

### Requirement: El plan del mes ofrece el ingreso ya descontado de la deuda

El plan del mes SHALL ofrecer igualar el presupuesto global a `max(0, Σ ingresos activos en CLP −
deuda del mes anterior)`, y el botón de la sugerencia SHALL aplicar exactamente ese número. La
oferta SHALL aparecer solo cuando el mes tiene presupuesto definido y el número sugerido difiere
del vigente.

Cuando el total ofrecido es 0 —la deuda se comió el ingreso entero— NO SHALL ofrecerse el botón:
dejar el presupuesto del mes en cero es una decisión del usuario, no algo que la app sugiera con un
clic. En ese estado SHALL quedar solo la explicación del descuento.

Cuando la deuda es mayor a 0, la etiqueta del botón NO SHALL prometer igualar al ingreso, porque el
número aplicado ya no es el ingreso.

Cuando la deuda es 0, la sugerencia SHALL comportarse como antes de este cambio: mismo total, mismo
texto y misma etiqueta de botón.

La sugerencia NO SHALL impedir repartir por sobre el total ofrecido: el usuario SHALL poder seguir
asignando de más y verlo como sobre-asignación, igual que hoy.

#### Scenario: El mes anterior cerró excedido

- **WHEN** los ingresos activos suman 1.400.000 y la deuda del mes anterior es 150.000
- **THEN** el plan ofrece 1.250.000

#### Scenario: Aplicar la sugerencia usa el número descontado

- **WHEN** el usuario aplica una sugerencia de 1.250.000 con ingresos por 1.400.000
- **THEN** el presupuesto global del mes queda en 1.250.000, no en 1.400.000

#### Scenario: Sin deuda el plan se comporta como antes

- **WHEN** la deuda del mes anterior es 0
- **THEN** el plan ofrece la suma de los ingresos activos, con el texto y la etiqueta de siempre, y
  no menciona ningún descuento

#### Scenario: La deuda supera a los ingresos

- **WHEN** los ingresos activos suman 1.400.000 y la deuda del mes anterior es 1.600.000
- **THEN** el total ofrecido es 0 y no un número negativo, y NO se ofrece el botón: la app explica
  que la deuda se llevó el ingreso del mes y deja la decisión al usuario

#### Scenario: El total ofrecido ya coincide con el presupuesto

- **WHEN** el presupuesto vigente del mes es igual al total ya descontado
- **THEN** no se ofrece ninguna sugerencia, aunque los ingresos por sí solos sumen otra cosa

#### Scenario: Repartir por sobre el total ofrecido sigue siendo posible

- **WHEN** el usuario asigna a las categorías más de lo que el plan ofrece
- **THEN** la app lo muestra como sobre-asignación y NO SHALL impedir la operación

### Requirement: La explicación del descuento sobrevive a aplicarlo

Mientras la deuda del mes anterior sea mayor a 0, el plan del mes SHALL mostrar de qué mes viene el
descuento y por cuánto, con independencia de que se esté ofreciendo o no la sugerencia. La
explicación NO SHALL desaparecer al aplicar el ajuste: es justo entonces cuando el presupuesto
queda más chico y hace falta saber por qué.

Cuando el mes anterior cae en otro año, la explicación SHALL nombrar el año: "diciembre" a secas,
leído en enero, no dice si es el que pasó o el que viene.

#### Scenario: Después de aplicar el ajuste

- **WHEN** el usuario aplica la sugerencia y el presupuesto queda igual al total descontado
- **THEN** la sugerencia deja de ofrecerse pero la explicación del descuento sigue visible

#### Scenario: Sin sugerencia que ofrecer

- **WHEN** la deuda se llevó el ingreso entero y no hay botón
- **THEN** la explicación del descuento se muestra igual

#### Scenario: Enero nombra el año de diciembre

- **WHEN** el mes en pantalla es enero de 2026 y la deuda viene de diciembre de 2025
- **THEN** la explicación dice "diciembre de 2025" y no solo "diciembre"

#### Scenario: Sin deuda no se explica nada

- **WHEN** la deuda del mes anterior es 0
- **THEN** el plan no muestra ninguna línea de descuento
