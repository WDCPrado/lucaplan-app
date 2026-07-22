## ADDED Requirements

### Requirement: El pago de tarjeta dispara las cuotas de sus planes

El evento de **pago de tarjeta de crédito** detectado en el correo SHALL disparar, además de
la proyección de saldos y cupo que ya realiza, la ejecución de la cuota correspondiente de
cada plan `card` de esa cuenta. La cuenta SHALL resolverse con el mismo mapeo de instrumento
que ya usa la proyección (últimos 4 de la tarjeta); un pago cuyo instrumento no se resuelve NO
SHALL ejecutar cuotas.

#### Scenario: Pago reconocido ejecuta las cuotas
- **WHEN** se importa un correo de pago de tarjeta de una cuenta con planes de cuotas pendientes
- **THEN** además de proyectarse el pago sobre el cupo, se ejecuta la cuota correspondiente de cada plan

#### Scenario: Pago sin instrumento resuelto no ejecuta cuotas
- **WHEN** llega un pago cuya tarjeta no puede mapearse a una cuenta del usuario
- **THEN** no se ejecuta ninguna cuota

### Requirement: El pago de cuota de crédito de consumo se engancha a su plan

El movimiento importado desde un correo de **pago de cuota de crédito de consumo** SHALL
ofrecerse a los planes `loan` de la cuenta de origen para que uno lo adopte como su cuota. El
movimiento SHALL conservarse aunque ningún plan lo reclame: sigue siendo un gasto real.

El enganche SHALL ejecutarse **antes** de la categorización por IA, igual que el match de
plantillas recurrentes: una cuota reclamada por un plan queda categorizada y revisada, y la IA
no la ve.

#### Scenario: La cuota importada se engancha al plan
- **WHEN** se importa el pago de una cuota de crédito de consumo y existe un plan `loan` de esa cuenta
- **THEN** el movimiento queda vinculado al ítem del plan, con la categoría del plan y sin pasar por IA

#### Scenario: Sin plan, la cuota sigue siendo gasto
- **WHEN** se importa el pago de una cuota y el usuario no tiene ningún plan `loan` de esa cuenta
- **THEN** el movimiento se conserva como gasto y pasa por la categorización normal

### Requirement: Un fallo en las cuotas no rompe la importación

El disparo de cuotas, en cualquiera de sus dos formas, SHALL ser best-effort respecto de la
importación: un fallo al ejecutar o enganchar cuotas NO SHALL revertir el import ni la
proyección de saldos ya aplicada.

#### Scenario: Un fallo ejecutando cuotas no rompe el import
- **WHEN** la ejecución de una cuota falla durante la importación
- **THEN** los movimientos importados y la proyección de saldos se conservan
