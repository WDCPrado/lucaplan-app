## ADDED Requirements

### Requirement: Fuente de ingreso como entidad del usuario

El sistema SHALL modelar las fuentes de ingreso como una entidad `Income` propia del
usuario: un usuario SHALL poder tener N fuentes de ingreso. Cada `Income` SHALL tener
nombre, monto (vía value object `Money`), moneda, día de ingreso del mes (`dayOfMonth`,
entero 1–31), estado `isActive`, una categoría de ingreso asociada y una **cuenta destino**
(`accountId`) donde entra el ingreso. La cuenta destino NO SHALL ser de crédito
(`credit_card`/`credit_line`): un ingreso entra a una cuenta que recibe dinero (checking,
savings, wallet, investment). La moneda de la fuente SHALL coincidir con la de su cuenta
destino. Las fuentes de ingreso SHALL crearse a mano; la recurrencia automática está fuera
de este alcance.

#### Scenario: Usuario con varias fuentes de ingreso

- **WHEN** el usuario registra "Sueldo" y "Arriendo" como fuentes de ingreso
- **THEN** ambas quedan asociadas a su cuenta como registros `Income` independientes

#### Scenario: Día de ingreso válido

- **WHEN** el usuario crea una fuente de ingreso con `dayOfMonth` fuera del rango 1–31
- **THEN** el sistema rechaza la creación por día inválido

#### Scenario: La cuenta destino no puede ser de crédito

- **WHEN** el usuario intenta crear una fuente de ingreso con cuenta destino de tipo `credit_card` o `credit_line`
- **THEN** el sistema rechaza la creación porque un ingreso no entra a una cuenta de crédito

### Requirement: Categoría de ingreso asociada

Cada `Income` SHALL asociarse a una categoría existente del usuario con `type='income'`
(reutiliza la entidad `Category`, sin taxonomía separada). Si el usuario no tiene aún una
categoría de ingreso adecuada, el sistema SHALL permitir crearla al momento de registrar la
fuente de ingreso.

#### Scenario: Asociar categoría de ingreso existente

- **WHEN** el usuario crea la fuente "Sueldo" y elige la categoría de ingreso "Remuneración"
- **THEN** la fuente queda relacionada a esa categoría `type='income'`

#### Scenario: Crear categoría de ingreso al vuelo

- **WHEN** el usuario registra una fuente de ingreso y no existe una categoría de ingreso adecuada
- **THEN** el sistema le permite crear una categoría `type='income'` y la asocia a la fuente

### Requirement: Generar el ingreso del mes de forma manual

El sistema SHALL permitir generar manualmente el movimiento de ingreso de un mes a partir
de una fuente de ingreso: crea una `Transaction` de ingreso (`direction=credit` con la
categoría `type=income` de la fuente) en la **cuenta destino** de la fuente, con el monto y
fecha en el `dayOfMonth` del mes elegido. La generación SHALL ser
idempotente por fuente y mes: no SHALL crear un segundo movimiento si ya existe uno generado
desde esa fuente en ese mes. La `Transaction` generada SHALL quedar vinculada a su fuente
(`incomeId`) como gancho para la recurrencia automática futura.

#### Scenario: Generar el ingreso del mes

- **WHEN** el usuario toca "generar" sobre la fuente "Sueldo" para julio 2026
- **THEN** se crea una `Transaction` de ingreso por el monto de la fuente, con su categoría y fecha en el día de ingreso de julio

#### Scenario: No duplicar en un mes ya generado

- **WHEN** el usuario toca "generar" sobre una fuente cuyo ingreso de ese mes ya fue generado
- **THEN** el sistema no crea un segundo movimiento y mantiene el existente
