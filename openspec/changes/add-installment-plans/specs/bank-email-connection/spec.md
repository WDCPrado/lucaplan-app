## ADDED Requirements

### Requirement: El pago de tarjeta dispara las cuotas de sus planes

El evento de **pago de tarjeta de crédito** detectado en el correo SHALL disparar, además de
la proyección de saldos y cupo que ya realiza, la ejecución de la cuota correspondiente de
cada plan de cuotas de esa cuenta. La cuenta SHALL resolverse con el mismo mapeo de instrumento que ya usa la
proyección (últimos 4 de la tarjeta); un pago cuyo instrumento no se resuelve NO SHALL
ejecutar cuotas.

El disparo SHALL ser best-effort respecto de la importación: un fallo al ejecutar cuotas NO
SHALL revertir el import ni la proyección de saldos ya aplicada.

#### Scenario: Pago reconocido ejecuta las cuotas
- **WHEN** se importa un correo de pago de tarjeta de una cuenta con planes de cuotas pendientes
- **THEN** además de proyectarse el pago sobre el cupo, se ejecuta la cuota correspondiente de cada plan

#### Scenario: Pago sin instrumento resuelto no ejecuta cuotas
- **WHEN** llega un pago cuya tarjeta no puede mapearse a una cuenta del usuario
- **THEN** no se ejecuta ninguna cuota

#### Scenario: Un fallo ejecutando cuotas no rompe el import
- **WHEN** la ejecución de una cuota falla durante la importación
- **THEN** los movimientos importados y la proyección de saldos se conservan
