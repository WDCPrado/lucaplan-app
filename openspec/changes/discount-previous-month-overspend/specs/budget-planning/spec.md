## ADDED Requirements

### Requirement: Deuda del mes anterior (derivada)

El sistema SHALL derivar, para un mes dado, la **deuda del mes anterior**: el excedente del mes del
mes inmediatamente anterior, es decir `max(0, gasto del mes anterior − límite global efectivo del
mes anterior)`. La deuda SHALL calcularse con la misma definición de gasto del mes que reporta la
vista de presupuesto de ese mes, de modo que el monto descontado y el excedente que ese mes muestra
sean siempre el mismo número.

La deuda NO SHALL derivarse del excedente de topes por categoría: pasarse de un tope teniendo
presupuesto global libre no genera deuda, porque la plata existía y solo estaba asignada a otra
cosa.

La deuda NO SHALL persistirse y NO SHALL acumular más de un mes: cada mes mira únicamente al
inmediatamente anterior.

#### Scenario: El mes anterior cerró por sobre su presupuesto

- **WHEN** el mes anterior tiene límite global efectivo 950.000 y un gasto del mes de 1.100.000
- **THEN** la deuda del mes anterior es 150.000

#### Scenario: El mes anterior cerró dentro de su presupuesto

- **WHEN** el mes anterior tiene límite global efectivo 1.500.000 y un gasto del mes de 1.100.000
- **THEN** la deuda del mes anterior es 0

#### Scenario: El mes anterior no tenía presupuesto definido

- **WHEN** el mes anterior no tiene límite global efectivo (ni propio ni heredado), aunque haya
  gasto registrado
- **THEN** la deuda del mes anterior es 0: no se puede pasar de un límite que no existe

#### Scenario: El mes en curso no genera su propia deuda

- **WHEN** el mes en curso está por sobre su presupuesto y el mes anterior cerró dentro del suyo
- **THEN** la deuda del mes anterior es 0: la cifra mira al mes anterior, no al que está en pantalla

#### Scenario: Enero mira a diciembre del año anterior

- **WHEN** el mes en pantalla es enero y diciembre del año anterior cerró por sobre su presupuesto
- **THEN** la deuda del mes anterior es el excedente de ese diciembre

#### Scenario: Los ingresos del mes anterior no descuentan la deuda

- **WHEN** el mes anterior recibió ingresos por sobre su gasto pero igual superó su límite global
- **THEN** la deuda es la diferencia entre el gasto y el límite global: los ingresos no participan
  del cálculo
