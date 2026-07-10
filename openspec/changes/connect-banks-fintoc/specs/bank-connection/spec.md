## ADDED Requirements

### Requirement: Conectar un banco vía el widget de Fintoc

El sistema SHALL permitir conectar un banco a través del widget de Fintoc en modo agregación de
datos (`product: 'movements'`). El cliente SHALL abrir el widget con la **public key** y un
**`webhookUrl`** provisto por el backend que incluye un **identificador de usuario firmado**. Al
completar el usuario la autenticación (incluida MFA, que resuelve Fintoc), Fintoc SHALL entregar el
**`link_token`** del banco vinculado a ese `webhookUrl`; el backend SHALL asociar el Link al usuario
(verificando el identificador firmado), persistirlo y sincronizar usando la **secret key**. La
secret key NUNCA SHALL llegar al cliente.

#### Scenario: Usuario conecta su banco
- **WHEN** el usuario completa la autenticación en el widget y Fintoc entrega el `link_token` al `webhookUrl`
- **THEN** el backend asocia el Link al usuario (por el identificador firmado), lo guarda y sincroniza

#### Scenario: La secret key no sale del servidor
- **WHEN** el cliente inicializa el widget
- **THEN** solo usa la public key y el `webhookUrl`; la secret key permanece en el servidor

#### Scenario: Entrega sin identificador válido se rechaza
- **WHEN** llega una entrega al `webhookUrl` sin identificador firmado válido ni firma de Fintoc reconocible
- **THEN** se rechaza (no se conecta ningún banco)

#### Scenario: El usuario abandona el widget
- **WHEN** el usuario cierra el widget sin completar la conexión
- **THEN** no se crea ningún Link ni banco, y el usuario puede reintentar

### Requirement: Sincronización idempotente de institución, cuentas y movimientos

Al conectar y al refrescar, el sistema SHALL sincronizar desde el Link: la **institución** como un
`Bank` de origen `fintoc`, sus **cuentas** como `FinancialAccount` de origen `fintoc` (con el
`balance` reportado por el proveedor) y sus **movimientos** como `Transaction` sin categoría. La
**primera** sincronización SHALL importar el **histórico de movimientos disponible**; toda
sincronización SHALL incluir los movimientos no confirmados (para detectar confirmaciones y
reversos). La sincronización SHALL ser **idempotente**: re-sincronizar el mismo Link NO SHALL
duplicar bancos, cuentas ni movimientos (dedupe por id externo del proveedor) NI recalcular el saldo
local.

#### Scenario: Primera sincronización crea banco, cuentas y movimientos
- **WHEN** se conecta un banco con dos cuentas y varios movimientos
- **THEN** se crean un `Bank` (origen fintoc), dos `FinancialAccount` (origen fintoc) y los movimientos como transacciones sin categoría

#### Scenario: Re-sincronizar no duplica
- **WHEN** se vuelve a sincronizar el mismo Link
- **THEN** los bancos, cuentas y movimientos ya existentes se actualizan por su id externo, sin crear duplicados

#### Scenario: Movimiento importado queda listo para categorizar
- **WHEN** entra un movimiento nuevo desde Fintoc
- **THEN** se guarda con `category_id` nulo y el usuario puede categorizarlo después

### Requirement: Cuentas conectadas de solo lectura

Una cuenta de origen `fintoc` SHALL ser de **solo lectura** para el usuario: su `balance` y sus
movimientos provienen del proveedor y se sobrescriben/importan en cada sincronización. El sistema
NO SHALL permitir editar la cuenta ni agregarle movimientos a mano, y la importación de sus
movimientos NO SHALL disparar el ajuste de saldo que aplica a las cuentas manuales.

Los **movimientos** de origen `fintoc` SHALL ser de **solo lectura**: solo Fintoc los crea y
actualiza (vía sincronización). El usuario NO SHALL editar sus datos (monto, descripción, fecha,
dirección, estado). Los movimientos importados quedan **sin categoría**; su categorización (con IA)
se abordará más adelante y queda fuera de este alcance.

#### Scenario: No se agregan movimientos a mano a una cuenta conectada
- **WHEN** el usuario intenta registrar un movimiento manual en una cuenta de origen fintoc
- **THEN** la acción no está disponible; sus movimientos solo llegan por sincronización

#### Scenario: El usuario no edita un movimiento de Fintoc
- **WHEN** el usuario intenta cambiar el monto, la descripción o la fecha de un movimiento de origen fintoc
- **THEN** la edición no está disponible; solo Fintoc actualiza esos datos vía sincronización

#### Scenario: El saldo lo manda el proveedor
- **WHEN** se sincroniza una cuenta conectada
- **THEN** su `balance` toma el valor reportado por Fintoc, sin recalcularse desde las transacciones locales

### Requirement: Actualización por webhook (tiempo real)

El sistema SHALL exponer un endpoint de **webhook** para recibir las notificaciones de Fintoc y
re-sincronizar el Link correspondiente al instante (movimientos nuevos, saldo), sin acción del
usuario. El webhook SHALL verificar la **firma** de cada petición antes de procesarla; una firma
inválida o ausente SHALL rechazarse sin sincronizar. El procesamiento SHALL ser idempotente:
reprocesar el mismo evento NO SHALL duplicar datos.

#### Scenario: Webhook válido dispara sincronización
- **WHEN** llega un webhook de Fintoc con firma válida indicando datos nuevos
- **THEN** el sistema sincroniza el Link y los movimientos nuevos aparecen sin que el usuario haga nada

#### Scenario: Webhook con firma inválida se rechaza
- **WHEN** llega una petición al webhook con firma inválida o ausente
- **THEN** se responde con error y no se sincroniza nada

#### Scenario: Reproceso del mismo evento no duplica
- **WHEN** Fintoc reintenta un evento ya procesado
- **THEN** la sincronización idempotente no crea movimientos duplicados

### Requirement: Refresco manual

El sistema SHALL permitir además refrescar manualmente una conexión (o cuenta) para forzar la
sincronización (respaldo del webhook). El refresco SHALL ser idempotente (no duplica).

#### Scenario: Refresco manual
- **WHEN** el usuario pulsa "Refrescar" en un banco conectado
- **THEN** el sistema vuelve a sincronizar cuentas y movimientos del Link, sin duplicar lo ya importado
