## ADDED Requirements

### Requirement: Tarjeta como entidad de la cuenta

Una `Cuenta` (`FinancialAccount`) SHALL poder tener **1 o más tarjetas** (`Card`). Una tarjeta
SHALL declarar su tipo (`debito` | `credito`), sus **últimos 4 dígitos** reales (`cardLast4`, nunca
el número completo) y su marca de presentación. Una cuenta corriente tiene **una** tarjeta de
débito; una cuenta de crédito puede tener **1+** tarjetas de crédito. Las tarjetas se crean solo si
el banco entrega **identidad real** de tarjeta (máscara/últimos 4); no se inventan.

#### Scenario: Cuenta corriente con tarjeta de débito
- **WHEN** se sincroniza una cuenta corriente de Banco de Chile
- **THEN** queda con una tarjeta de débito con sus últimos 4 dígitos reales

#### Scenario: Cuenta de crédito con una o más tarjetas
- **WHEN** una cuenta de crédito tiene dos plásticos distintos con máscaras propias
- **THEN** se modela como dos tarjetas bajo esa misma cuenta

### Requirement: Saldos por bucket (medición mutable)

Un saldo/cupo SHALL modelarse como **`BalanceBucket`**: una **medición mutable** con
`tipo` (`cash` | `overdraft` | `credit_national` | `credit_international`), `currency`, y los montos
`limit` / `used` / `available`, más `asOf` (marca de tiempo del dato del banco). Un bucket pertenece
a una tarjeta (o a la cuenta, para el `cash`/`overdraft` de la corriente). Los buckets de distinta
moneda (CLP nacional, USD internacional) SHALL mantenerse **separados** y NUNCA sumarse.

#### Scenario: Tarjeta de crédito con dos cupos
- **WHEN** una tarjeta de crédito reporta cupo nacional (CLP) e internacional (USD)
- **THEN** se guardan dos buckets: `credit_national` en CLP y `credit_international` en USD, cada uno con su `limit/used/available` y `asOf`

#### Scenario: Los cupos no se suman entre monedas
- **WHEN** la UI o un cálculo intenta combinar el cupo CLP y el USD
- **THEN** se mantienen separados; sumar CLP con USD sigue siendo un error de dominio (`Money`)

#### Scenario: El bucket es una medición, no un libro
- **WHEN** se sincroniza y el `used`/`available` cambia
- **THEN** se actualiza el bucket (con nuevo `asOf`) sin que ello reasigne a qué cuenta pertenecen las transacciones

### Requirement: Sobregiro como bucket tratado como deuda

El sobregiro de una cuenta corriente SHALL modelarse como un bucket `overdraft` de la cuenta, con
su `limit` (línea autorizada) y su `used` = **deuda**. El `used` SHALL **calcularlo el sistema** como
`línea autorizada − línea disponible` (no tomar el "disponible" del banco como caja: el banco lo
infla sumándole la línea de sobregiro). El sobregiro disponible SHALL quedar **fuera de la caja
activa** (es capacidad de deuda, no dinero). El bucket `overdraft` SHALL poder destacarse en la UI
como parte de la cuenta pero distinto del `cash`.

#### Scenario: Uso de sobregiro es deuda, no caja
- **WHEN** la cuenta usa 100.000 de su línea de sobregiro
- **THEN** el bucket `overdraft` marca `used = 100.000` como deuda, y el disponible de la línea no cuenta como caja activa

#### Scenario: El usado se calcula, no se toma el disponible como caja
- **WHEN** el banco muestra la línea de sobregiro sumada al "disponible" (ingreso desde el sobregiro)
- **THEN** el sistema calcula el `used` como `línea autorizada − línea disponible` y no cuenta el disponible del banco como caja

### Requirement: Transacción pertenece a la cuenta y referencia un bucket

Un `Transaction` SHALL colgar de la **cuenta** (`FinancialAccount`), no de un bucket. MAY referenciar
el bucket al que corresponde (p. ej. `credit_national` vs `credit_international`) **solo** cuando el
banco lo identifique sin ambigüedad. La moneda del movimiento SHALL coincidir con la del bucket
referenciado (o de la cuenta si no hay bucket).

#### Scenario: Movimiento de tarjeta internacional referencia su bucket
- **WHEN** entra un movimiento en USD del cupo internacional
- **THEN** cuelga de la cuenta de crédito y referencia el bucket `credit_international` (USD)

#### Scenario: Sin referencia de bucket ambigua
- **WHEN** el banco no identifica a qué cupo pertenece un movimiento
- **THEN** el movimiento cuelga de la cuenta sin referenciar un bucket, en vez de asignarlo a uno equivocado

## MODIFIED Requirements

### Requirement: Origen de bancos y cuentas

`Bank`, `FinancialAccount`, `Card` y `Transaction` SHALL declarar su **origen** (`provider`):
`manual` (creado por el usuario) o `bancochile` (leído del portal por el conector local). Las
entidades de origen `bancochile` son de solo lectura y su saldo/cupo proviene del banco (se
sobrescribe en cada sincronización); las `manual` derivan su saldo de sus movimientos. Los
movimientos de cuenta corriente de origen `bancochile` MUST guardar el **`id` del banco** como id
externo para upsert; los de **tarjeta no facturada** se persisten **sin id externo** (snapshot).

#### Scenario: Cuenta conectada trae su origen
- **WHEN** se sincroniza una cuenta desde el portal
- **THEN** se guarda con `provider = bancochile` y de solo lectura

#### Scenario: Movimiento de cuenta corriente guarda id externo
- **WHEN** se importa un movimiento de la cartola
- **THEN** guarda el `id` del banco como id externo, para upsert sin duplicar

#### Scenario: No facturado se persiste sin id externo
- **WHEN** se importa un movimiento no facturado de tarjeta
- **THEN** se guarda sin id externo (forma parte de un snapshot que se reemplaza entero)

### Requirement: Tipos de cuenta

Cada cuenta SHALL declarar su `account_type` (p.ej. `checking`, `savings`, `credit_card`,
`credit_line`, `wallet`, `investment`). Solo el bucket `cash` de una cuenta `checking` SHALL contar
para la caja activa (ver `budget-planning`); los buckets `overdraft`, `credit_national` y
`credit_international` NO cuentan como caja (son deuda/capacidad de deuda).

#### Scenario: Tipo y bucket determinan el rol
- **WHEN** una cuenta `checking` tiene bucket `cash` y bucket `overdraft`
- **THEN** solo el `cash` cuenta como caja activa; el `overdraft` es deuda y no cuenta

### Requirement: Importación idempotente y mutable de movimientos

Un `Transaction` de **cuenta corriente** importado del banco MUST guardar el **`id` externo** y ser
**único por cuenta** (upsert por id): si el mismo movimiento vuelve con datos distintos, se
**actualiza** en su lugar, **preservando la categoría** ya asignada, sin duplicar. Los movimientos
de **tarjeta no facturada** NO tienen id estable: se manejan por **snapshot-replace** de la foto
completa de la tarjeta (no upsert por id). La importación NO SHALL disparar el ajuste de saldo de
las cuentas manuales.

#### Scenario: Mismo movimiento de cartola no se duplica
- **WHEN** una sincronización vuelve a traer un movimiento de cuenta corriente ya importado
- **THEN** se reconoce por su id externo y se actualiza en su lugar, conservando su categoría

#### Scenario: No facturados se reemplazan, no se upsertean
- **WHEN** se sincronizan los no facturados de una tarjeta
- **THEN** se reemplaza la foto completa de esa tarjeta, sin intentar un upsert por id inexistente

### Requirement: Número de tarjeta de la cuenta

La **tarjeta** (`Card`) SHALL almacenar los **últimos 4 dígitos** reales (`cardLast4`), NUNCA el
número completo, y SHALL ser exactamente 4 dígitos numéricos. Las cuentas sin tarjeta (ahorro,
billetera) NO tienen `Card`.

#### Scenario: Solo se guardan 4 dígitos reales
- **WHEN** se registra o sincroniza una tarjeta
- **THEN** se persisten exactamente los últimos 4 dígitos numéricos reales, no el número completo ni el id interno
