# incomes Specification

## Purpose
TBD - created by archiving change add-onboarding-and-incomes. Update Purpose after archive.
## Requirements
### Requirement: Fuente de ingreso como entidad del usuario

El sistema SHALL modelar las fuentes de ingreso como una entidad `Income` propia del
usuario: un usuario SHALL poder tener N fuentes de ingreso. Cada `Income` SHALL tener
nombre, moneda, día de ingreso del mes (`dayOfMonth`,
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

### Requirement: Monto de la fuente por mes con carry-forward

El monto de una fuente de ingreso SHALL guardarse **por mes**, con las mismas reglas que el
límite de una categoría: el monto efectivo de (year, month) es el registro de ese mes si
existe; si no, el del mes anterior más reciente (carry-forward). Editar el monto SHALL
escribir únicamente en el mes que el usuario está viendo, sin alterar los meses anteriores.

Un mes **anterior al primer registro** de la fuente SHALL considerarse un mes en que la
fuente no existía: NO SHALL listarse ni sumarse ahí. Navegar hacia meses pasados NO SHALL
crear registros.

#### Scenario: Editar el mes en curso no reescribe el pasado
- **WHEN** el sueldo vale 900.000 en julio y el usuario lo edita a 1.200.000 estando en agosto
- **THEN** julio conserva 900.000 y agosto queda en 1.200.000

#### Scenario: Un mes sin registro hereda el previo
- **WHEN** el último registro del sueldo es el de agosto y el usuario abre noviembre
- **THEN** noviembre muestra el monto de agosto, sin crear un registro nuevo

#### Scenario: Antes de existir, la fuente no aparece
- **WHEN** el usuario crea el sueldo en agosto y navega a julio
- **THEN** el sueldo no se lista en julio ni suma en los cálculos de ese mes

### Requirement: Eliminar una fuente termina su vigencia, no borra su historia

Eliminar una fuente de ingreso desde un mes SHALL significar que **deja de existir a partir de
ese mes** (inclusive): los meses anteriores SHALL conservar su monto, su listado y los
movimientos ya generados, con el mismo criterio que editar (que solo escribe en el mes en
curso). Desde el mes de fin en adelante, la fuente NO SHALL listarse ni sumarse en los
cálculos.

Cuando la fuente no tiene historia previa al mes desde el que se elimina (se creó y se
elimina dentro del mismo mes), el sistema SHALL borrarla por completo: no hay nada que
conservar.

#### Scenario: Eliminar en un mes posterior conserva el pasado
- **WHEN** el sueldo existe desde julio y el usuario lo elimina estando en septiembre
- **THEN** julio y agosto siguen mostrándolo con su monto, y desde septiembre deja de aparecer y de sumar

#### Scenario: Eliminar recién creada la borra del todo
- **WHEN** el usuario crea una fuente en julio y la elimina el mismo julio
- **THEN** la fuente se borra por completo, sin dejar registro

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
categoría `type=income` de la fuente) en la **cuenta destino** de la fuente, con el monto
vigente de ese mes y
fecha en el `dayOfMonth` del mes elegido. La generación SHALL ser
idempotente por fuente y mes: no SHALL crear un segundo movimiento si ya existe uno generado
desde esa fuente en ese mes. La `Transaction` generada SHALL quedar vinculada a su fuente
(`incomeId`) como gancho para la recurrencia automática futura.

Si la cuenta destino es conectada (su saldo vive en buckets), el abono generado SHALL
proyectarse sobre los buckets igual que un abono manual: paga primero el sobregiro usado y el
remanente sube la caja, dejando el saldo de la cuenta = caja disponible. Deshacer la
generación SHALL revertir la proyección con el monto real del movimiento (débito: consume
caja y el exceso vuelve al sobregiro). En cuentas manuales solo se ajusta el saldo simple.

#### Scenario: Generar el ingreso del mes

- **WHEN** el usuario toca "generar" sobre la fuente "Sueldo" para julio 2026
- **THEN** se crea una `Transaction` de ingreso por el monto de la fuente, con su categoría y fecha en el día de ingreso de julio

#### Scenario: No duplicar en un mes ya generado

- **WHEN** el usuario toca "generar" sobre una fuente cuyo ingreso de ese mes ya fue generado
- **THEN** el sistema no crea un segundo movimiento y mantiene el existente

#### Scenario: Generar hacia una cuenta conectada con sobregiro usado

- **WHEN** el usuario genera el ingreso "Sueldo" de $900.000 hacia una corriente conectada con caja $0 y sobregiro usado $290.967
- **THEN** el sobregiro queda pagado ($0 usado), la caja sube a $609.033 y el saldo de la cuenta muestra $609.033

