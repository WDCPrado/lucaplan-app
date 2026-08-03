## MODIFIED Requirements

### Requirement: Filtrado cerrado de notificaciones Banco de Chile

El sistema SHALL crear movimientos de gasto únicamente desde remitentes exactos de Banco de Chile y estos asuntos: `Cargo en Cuenta`, `Compra con Tarjeta de Crédito`, `Transferencia a Terceros` o el prefijo `Transferencias de Fondos a `. El asunto `Comprobante Pago Credito Consumo` SHALL producir un gasto CLP. El sistema SHALL reconocer desde `serviciodetransferencias@bancochile.cl` los asuntos `Pago de Tarjeta de Crédito Nacional` y `Pago de Tarjeta de Crédito Internacional` (normalizados, y con validación secundaria del cuerpo `se ha efectuado el pago de la tarjeta de crédito`) y procesarlos exclusivamente como pago interno de tarjeta (ver "Pago de tarjeta de crédito con dos patas"). MAY procesar `Aviso de transferencia de fondos` y comprobantes de pago de línea exclusivamente como movimientos internos de balance. Todo correo que no coincida con estas reglas SHALL ser ignorado. Los cuerpos y datos personales del correo SHALL NOT persistirse una vez extraído el evento necesario. Cuando una plantilla permitida incluya comercio o destinatario, el sistema MUST usar ese detalle como descripción del movimiento y SHALL NOT sustituirlo por el asunto genérico del correo.

#### Scenario: Compra con cargo en cuenta
- **WHEN** llega desde `enviodigital@bancochile.cl` un correo `Cargo en Cuenta` con la frase `compra por <monto> con cargo a Cuenta <cuenta> en <comercio> el <fecha>`
- **THEN** el sistema genera un débito CLP para la cuenta mapeada y usa `<comercio>` como descripción antes de categorizar

#### Scenario: Transferencia saliente
- **WHEN** llega desde `serviciodetransferencias@bancochile.cl` una `Transferencia a Terceros` o `Transferencias de Fondos a <comercio>` CLP con ID TEF
- **THEN** el sistema genera un débito CLP con ese ID TEF como identidad bancaria estable

#### Scenario: Remitente o asunto desconocido
- **WHEN** llega un correo cuyo remitente o asunto no coincide exactamente con la allowlist
- **THEN** el sistema lo ignora sin crear una transacción

## ADDED Requirements

### Requirement: Pago de tarjeta de crédito con dos patas

El sistema SHALL procesar los comprobantes con asunto `Pago de Tarjeta de Crédito Nacional` e `Internacional` (remitente `serviciodetransferencias@bancochile.cl`) como un **pago interno de dos patas**, ambas marcadas `isInternal`, visibles en el historial pero excluidas de ingreso, gasto categorizable, presupuesto y categorización por IA:

- **Pata de caja:** un débito que reduce la caja de la **cuenta corriente de origen** (sección "Origen") por el monto pagado en CLP.
- **Pata de deuda:** un crédito interno que reduce el `Utilizado` de la **tarjeta de destino** (sección "Destino", por últimos 4) en el bucket de su moneda —`credit_national` para el nacional, `credit_international` para el internacional— liberando cupo.

El monto pagado SHALL leerse por **etiqueta** (`Monto` en el nacional; `Monto pagado` en USD para la deuda y `Monto` en CLP para la caja en el internacional) y NUNCA desde la etiqueta `Utilizado`, que es la deuda previa. En el internacional cada pata SHALL usar su propia moneda y el sistema SHALL NOT recalcular el tipo de cambio informado por el banco. El sistema SHALL NOT persistir ni registrar el número completo de la tarjeta ni de la cuenta.

Cada pata SHALL tener una identidad idempotente propia y estable, derivada del campo `Transacción` del correo (con Message-ID de fallback) sufijada por pata, de modo que reprocesar el mismo correo no duplique ninguno de los dos movimientos. Si falta el monto pagado, la cuenta de origen o la tarjeta de destino en los instrumentos confirmados, el sistema SHALL omitir el correo **completo** (fail-closed), sin registrar medio pago.

#### Scenario: Pago de tarjeta nacional descuenta caja y libera cupo
- **WHEN** llega el asunto `Pago de Tarjeta de Crédito Nacional` con `Utilizado $540.835` y `Monto $652.580`, cuenta de origen en "Origen" y `N° de tarjeta ************2120`
- **THEN** el sistema registra un débito interno de $652.580 en la caja de la cuenta corriente y un crédito interno de $652.580 en el bucket `credit_national` de la tarjeta ••••2120, tomando el `Monto` y nunca el `Utilizado`
- **AND** ninguno de los dos cuenta como gasto, ingreso ni presupuesto, ni se envía al categorizador de IA

#### Scenario: Mismo remitente, otro comprobante, no es pago de tarjeta
- **WHEN** llega desde `serviciodetransferencias@bancochile.cl` una `Transferencia a Terceros` o un pago de línea de crédito
- **THEN** el sistema NO lo procesa como pago de tarjeta; la detección exige el asunto exacto de pago de tarjeta y su validación de cuerpo

#### Scenario: Pago de tarjeta internacional es bimoneda
- **WHEN** llega `Comprobante pago Tarjeta de Crédito Internacional` con `Monto pagado USD$142,05`, `Tipo de cambio $947` y `Monto $134.571`
- **THEN** la pata de deuda reduce el bucket `credit_international` de la tarjeta en USD$142,05 y la pata de caja reduce la cuenta corriente en $134.571 CLP, sin recalcular el tipo de cambio

#### Scenario: Reprocesar el correo no duplica ninguna pata
- **WHEN** el webhook o el delta vuelven a entregar el mismo comprobante de pago de tarjeta
- **THEN** las dos patas se reconocen por su identidad sufijada y no se crean movimientos ni proyecciones duplicados

#### Scenario: Instrumento faltante omite el pago completo
- **WHEN** el comprobante identifica la tarjeta pero su cuenta corriente de origen (o la tarjeta) no está entre los instrumentos confirmados
- **THEN** el sistema omite el correo completo sin registrar ninguna de las dos patas
