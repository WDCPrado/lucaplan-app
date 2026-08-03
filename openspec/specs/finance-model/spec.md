# finance-model

## Purpose

Modelo de datos del dominio financiero de LucaPlan: bancos y cuentas (con tipo, moneda y saldo) y
movimientos categorizables, con las invariantes de moneda y tipo de cuenta. Base multi-banco
(Banco de Chile como primer caso). Fuente de verdad del esquema: `prisma/schema.prisma`; dominio
en `arch/v1/domain/finance/`.
## Requirements
### Requirement: Bancos y cuentas del usuario

El sistema SHALL permitir que un usuario tenga N bancos (entidades financieras) y que cada banco
tenga N cuentas. Un banco y sus cuentas MAY ser de origen `manual` (creados por el usuario) o
`bancochile` (agregados al conectar el banco por correo). Cada cuenta MUST tener un
`account_type`, una moneda (`currency_code`) y un saldo (`balance`). Las claves foráneas a usuario
MUST usar el tipo del `User.id` existente (`String`), no UUID. Un banco MUST pertenecer a un
usuario y una cuenta a un banco.

#### Scenario: Usuario con varios bancos y cuentas
- **WHEN** un usuario crea "Banco de Chile" con una cuenta corriente CLP y una tarjeta de crédito
- **THEN** ambas cuentas referencian ese banco y ese usuario, cada una con su `account_type` y moneda

#### Scenario: Cuenta en otra moneda
- **WHEN** se agrega una cuenta de tarjeta internacional en USD
- **THEN** coexiste con las cuentas CLP; su `currency_code` es USD

#### Scenario: Banco conectado por correo
- **WHEN** el usuario conecta un banco por correo
- **THEN** ese banco y sus cuentas quedan con origen `bancochile` y conviven con los manuales del usuario

### Requirement: Tipos de cuenta

Cada cuenta SHALL declarar su `account_type` (p.ej. `checking`, `savings`, `credit_card`,
`credit_line`, `wallet`, `investment`). Solo las cuentas de tipo `checking` cuentan para la caja
activa (ver `budget-planning`).

#### Scenario: Tipo determina rol
- **WHEN** una cuenta es `checking` y otra `credit_card`
- **THEN** el sistema puede distinguirlas por `account_type` para cálculos derivados

### Requirement: Sobregiro en cuenta corriente

El sistema SHALL permitir que una cuenta `checking` tenga `overdraft_limit` (línea de sobregiro) y
`balance` negativo. Un `balance` negativo SHALL interpretarse como **deuda con el banco**
(sobregiro usado), no como caja. El sobregiro disponible (`overdraft_limit − sobregiro usado`)
SHALL quedar fuera de la caja aunque el banco lo muestre como saldo disponible.

#### Scenario: Uso de sobregiro genera deuda
- **WHEN** la cuenta tiene `overdraft_limit` 1.000.000 y se gasta 100.000 desde el sobregiro
- **THEN** el `balance` queda en −100.000, que representa una deuda de 100.000 con el banco

#### Scenario: Sobregiro disponible no es caja
- **WHEN** quedan 900.000 de sobregiro disponible
- **THEN** esos 900.000 no cuentan como caja activa (es capacidad de deuda, no dinero)

### Requirement: Movimientos categorizables

El sistema SHALL almacenar movimientos (`transactions`) colgando de una cuenta, con `amount`,
`currency_code`, `direction` (`debit`/`credit`), fecha y descripción. Un movimiento MAY tener una
categoría (`category_id` nullable: se permite sin categorizar). La moneda del movimiento SHALL
coincidir con la de su cuenta.

#### Scenario: Movimiento sin categoría
- **WHEN** se registra un movimiento aún no clasificado
- **THEN** se guarda con `category_id` nulo y puede categorizarse después

#### Scenario: Dirección del movimiento
- **WHEN** se registra un gasto y luego un ingreso en una cuenta
- **THEN** el gasto es `direction = debit` y el ingreso `direction = credit`

### Requirement: Integridad de moneda

El sistema NO SHALL mezclar montos de distinta moneda en un mismo cálculo sin conversión. El
value object `Money` MUST rechazar operar entre monedas distintas.

#### Scenario: Sumar distinta moneda falla
- **WHEN** se intenta sumar un monto CLP con uno USD
- **THEN** la operación lanza un error de dominio en vez de producir un total sin sentido

### Requirement: Número de tarjeta de la cuenta

La cuenta SHALL almacenar los **últimos 4 dígitos** de su tarjeta (`cardLast4`) cuando su tipo
tiene tarjeta; NUNCA el número completo. `cardLast4` MUST ser obligatorio para los tipos con
tarjeta (`checking` = tarjeta de débito, `credit_card` = tarjeta de crédito) y SHALL quedar
nulo/ausente para los tipos sin tarjeta (`savings`, `wallet`). El valor persistido MUST ser
exactamente 4 dígitos numéricos.

#### Scenario: Cuenta corriente exige últimos 4 dígitos
- **WHEN** se crea una cuenta corriente (`checking`) sin los últimos 4 dígitos
- **THEN** la creación falla con un error de validación (los 4 dígitos son obligatorios)

#### Scenario: Cuenta de ahorro sin tarjeta
- **WHEN** se crea una cuenta de ahorro (`savings`)
- **THEN** no se pide ni se guarda `cardLast4` (queda nulo)

#### Scenario: Solo se guardan 4 dígitos
- **WHEN** se ingresa el número de una tarjeta
- **THEN** solo se persisten los últimos 4 dígitos, y son exactamente 4 dígitos numéricos

### Requirement: Presentación de categorías y cuentas

El sistema SHALL soportar campos de presentación opcionales para la UI: `icon` (emoji) y `color`
en categorías, y `color` en cuentas. Estos campos MUST NOT afectar ningún cálculo financiero (uso,
caja activa, estado, posición neta).

#### Scenario: Categoría con emoji y color
- **WHEN** se crea la categoría "Compras" con `icon` 🛍️ y un `color`
- **THEN** la UI la muestra con ese emoji y ese color en el anillo y en los movimientos
- **AND** su límite, uso y estado se calculan igual que sin esos campos

#### Scenario: Presentación es opcional
- **WHEN** una categoría o cuenta no define `icon`/`color`
- **THEN** el sistema usa un valor por defecto y ningún cálculo se ve afectado

### Requirement: Origen de bancos y cuentas

`Bank` y `FinancialAccount` SHALL declarar su **origen** (`provider`): `manual` (creado por el
usuario) o `bancochile` (agregado por la conexión de correo). Las entidades de origen `bancochile` MUST guardar el
**id externo** (número de cuenta / últimos 4) para poder re-sincronizar sin duplicar. El `balance` de
una cuenta de origen `bancochile` SHALL provenir de la proyección de saldos (se sobrescribe en cada sincronización);
el de una cuenta `manual` SHALL derivarse de sus movimientos como hasta ahora.

#### Scenario: Cuenta conectada trae su origen e id externo
- **WHEN** se sincroniza una cuenta desde la conexión de correo
- **THEN** se guarda con `provider = bancochile` y el id externo de la cuenta

#### Scenario: Cuenta manual conserva su comportamiento
- **WHEN** el usuario crea una tarjeta a mano
- **THEN** se guarda con `provider = manual` y su saldo se deriva de sus movimientos

#### Scenario: El saldo de la cuenta conectada lo fija la proyección
- **WHEN** se re-sincroniza una cuenta de origen `bancochile`
- **THEN** su `balance` toma el valor de la proyección de saldos, sin recalcularse desde las transacciones locales

### Requirement: Importación idempotente y mutable de movimientos

Un `Transaction` importado desde el proveedor MUST guardar el **id externo** del movimiento y ser
**único por cuenta** (dedupe). La importación SHALL ser un **upsert por id externo**: si el mismo
movimiento vuelve con datos distintos (monto, fechas, descripción, estado) —lo que ocurre porque el
banco los ajusta hasta días después— el sistema SHALL **actualizar** la fila existente, sin
duplicar. El upsert SHALL **preservar la categoría** ya asignada al movimiento (metadata de
LucaPlan, no del proveedor) para que una futura categorización no se pierda al re-importar. Los
movimientos importados entran **sin categoría** y NO SHALL disparar el ajuste de saldo que aplica a
las cuentas manuales (el saldo de la cuenta conectada lo fija el proveedor).

#### Scenario: Mismo movimiento no se duplica
- **WHEN** una sincronización vuelve a traer un movimiento ya importado
- **THEN** se reconoce por su id externo y se actualiza en su lugar, sin crear un duplicado

#### Scenario: Movimiento que cambia se actualiza
- **WHEN** el banco ajusta el monto, la fecha o la descripción de un movimiento ya importado
- **THEN** la fila se actualiza con los nuevos valores, conservando la categoría ya asignada (si la hubiera)

#### Scenario: Import no altera el saldo local
- **WHEN** se importan movimientos de una cuenta conectada
- **THEN** el saldo de la cuenta no se recalcula por esos movimientos (lo fija el proveedor)

### Requirement: Estados del movimiento

Un `Transaction` importado MUST guardar el **estado** que reporta el proveedor
(`confirmed` | `pending` | `reversed` | `duplicated`) y actualizarlo en cada sincronización. Solo
los movimientos **`confirmed`** SHALL contar para la caja activa, el uso de categorías y el
presupuesto; los `pending`, `reversed` y `duplicated` SHALL excluirse de esos cálculos. Un
movimiento que pasa a `reversed`/`duplicated` SHALL dejar de contar automáticamente al
sincronizarse (sin borrarse ni duplicarse). Los movimientos manuales se consideran `confirmed`.

Adicionalmente, el estado `pending` SHALL usarse para el **gasto comprometido**: un
movimiento que el sistema ya sabe que ocurrirá (materializado por una plantilla recurrente)
pero que aún no se ha cobrado. Un movimiento `pending` sigue **sin contar** como gasto en
los cálculos anteriores; SHALL poder reportarse aparte como comprometido del mes.

Al cobrarse, el período SHALL quedar con **un solo** movimiento confirmado, sin doble
conteo: cuando el cobro no viene del banco (ejecución por cron) el mismo movimiento (mismo
id) pasa a `confirmed`; cuando el cobro llega importado desde el banco, el movimiento
importado —que ya trae su identidad externa y ya movió los saldos— es el que queda como
ejecución confirmada y el comprometido se consume.

#### Scenario: Pending pasa a confirmed
- **WHEN** un movimiento pending se confirma en el banco y llega la sincronización
- **THEN** el mismo movimiento (mismo id) queda `confirmed` y pasa a contar para los cálculos

#### Scenario: Movimiento reversado deja de contar
- **WHEN** un movimiento confirmado se marca `reversed` en una sincronización posterior
- **THEN** deja de contar para caja/presupuesto, sin borrarse ni duplicarse

#### Scenario: Comprometido no cuenta como gasto
- **WHEN** una plantilla recurrente materializa su movimiento del mes como `pending`
- **THEN** el uso de la categoría y la caja activa no lo incluyen, y queda disponible como comprometido del mes

### Requirement: Memoria de correcciones de categorización

El modelo SHALL incluir una entidad de **corrección de categorización** por usuario: la descripción
normalizada de un movimiento y su dirección apuntando a la categoría que el usuario eligió, con una
nota opcional que explica qué es el movimiento y una descripción original de ejemplo. SHALL existir a
lo más una corrección por (usuario, dirección, texto normalizado). La corrección referencia la
categoría con borrado en cascada: eliminar la categoría elimina sus correcciones. La entidad es
contexto para la categorización con IA y NO SHALL entrar en ningún cálculo financiero (saldos,
presupuestos, usos).

#### Scenario: Una corrección vigente por texto

- **WHEN** se registra una corrección para un (usuario, dirección, texto normalizado) que ya tiene una
- **THEN** la nueva reemplaza a la anterior; nunca conviven dos para la misma clave

#### Scenario: Borrar la categoría se lleva sus correcciones

- **WHEN** el usuario elimina una categoría con correcciones asociadas
- **THEN** las correcciones se eliminan en cascada

#### Scenario: No afecta cálculos

- **WHEN** se calculan saldos, usos o presupuestos
- **THEN** las correcciones no participan en ninguna fórmula

### Requirement: Descripción opcional de categoría

Una categoría MAY tener una **descripción** opcional (texto libre) que aclara qué movimientos le corresponden y MUST NOT afectar ningún cálculo financiero (límite, uso, caja activa, estado, posición neta).
La descripción se usa como contexto para la categorización con IA (ver `ai-categorization`). Una
categoría sin descripción SHALL comportarse exactamente como hasta ahora.

#### Scenario: Categoría con descripción
- **WHEN** se crea la categoría "Supermercado" con la descripción "compras de comida y hogar en super/almacén"
- **THEN** la descripción se guarda y queda disponible como contexto para la IA
- **AND** su límite, uso y estado se calculan igual que sin descripción

#### Scenario: Descripción es opcional
- **WHEN** una categoría no define descripción
- **THEN** el sistema la trata como vacía y ningún cálculo ni comportamiento cambia

### Requirement: Vínculo del movimiento con la cuota que lo generó

Un `Transaction` SHALL poder referenciar el ítem de cuota (`InstallmentItem`) que lo originó o
que lo adoptó, con relación 1:1 (un ítem tiene a lo sumo un movimiento). Ese vínculo SHALL ser
la garantía de idempotencia del sistema de cuotas: reprocesar un correo no puede producir un
segundo movimiento para el mismo ítem.

El movimiento de una cuota SHALL conservar la categoría del plan y NO SHALL recategorizarse
por IA.

Una compra transformada en cuotas SHALL poder quedar **neutralizada**: marcada como interna
(no cuenta como gasto ni caja) y referenciada desde su `InstallmentPlan` como transacción
origen, conservándose para trazabilidad en vez de eliminarse.

#### Scenario: Cuota creada enganchada a su ítem
- **WHEN** el pago de la tarjeta ejecuta la cuota 3 de un plan `card`
- **THEN** la `Transaction` creada queda vinculada al ítem 3 y con la categoría del plan

#### Scenario: Cuota adoptada enganchada a su ítem
- **WHEN** un plan `loan` adopta el movimiento importado del pago de su cuota 3
- **THEN** ese movimiento queda vinculado al ítem 3 y con la categoría del plan, sin crearse otro

#### Scenario: Compra origen neutralizada y trazable
- **WHEN** una compra se transforma en un plan de cuotas
- **THEN** la compra original queda interna (no cuenta como gasto) y referenciada desde el plan, sin borrarse

### Requirement: Vínculo del movimiento con su plantilla recurrente

Un `Transaction` SHALL poder referenciar la plantilla recurrente que lo originó
(`recurringTemplateId`, nullable), del mismo modo que ya referencia su fuente de ingreso.
Un movimiento vinculado SHALL conservar la categoría de la plantilla y NO SHALL ser
recategorizado automáticamente. Eliminar la plantilla NO SHALL borrar los movimientos ya
confirmados: SHALL dejarlos sin vínculo.

#### Scenario: Movimiento generado queda enganchado
- **WHEN** una plantilla recurrente materializa el movimiento de su período
- **THEN** el movimiento queda con `recurringTemplateId` apuntando a la plantilla

#### Scenario: Borrar la plantilla conserva los movimientos
- **WHEN** se elimina una plantilla con movimientos confirmados
- **THEN** esos movimientos se conservan con `recurringTemplateId` en null

