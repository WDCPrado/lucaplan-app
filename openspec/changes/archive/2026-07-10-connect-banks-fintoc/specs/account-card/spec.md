## ADDED Requirements

### Requirement: Distintivo de cuenta conectada

Una cuenta de origen `fintoc` SHALL mostrarse con un **distintivo de "conectado"** y una acción de
**refrescar**, y SHALL renderizarse como **solo lectura** (sin editar ni agregar movimientos a
mano). El resto de su presentación (arte por banco/tipo, últimos 4 dígitos, saldo/cupo) SHALL
seguir las reglas de tarjeta existentes.

#### Scenario: Cuenta conectada muestra distintivo y refrescar
- **WHEN** una cuenta tiene origen `fintoc`
- **THEN** su tarjeta muestra el distintivo de "conectado" y ofrece refrescar, sin acciones de edición manual

#### Scenario: Cuenta manual no muestra distintivo de conexión
- **WHEN** una cuenta tiene origen `manual`
- **THEN** su tarjeta no muestra el distintivo de "conectado"

## MODIFIED Requirements

### Requirement: Preview al crear la cuenta

El alta manual SHALL ser de **tarjetas**: el modal se titula "Nueva tarjeta" y solo ofrece los
tipos con tarjeta (corriente = débito, crédito). SHALL mostrar en vivo la tarjeta con el arte
correspondiente cuando el usuario elige banco y tipo, y los últimos 4 dígitos SHALL ser siempre
obligatorios. Las cuentas bancarias sin tarjeta (ahorro, billetera) NO se crean a mano: llegan por
conexión con el proveedor (ver `bank-connection`).

#### Scenario: Modal de tarjeta con preview en vivo
- **WHEN** el usuario abre "Nueva tarjeta" y elige Banco de Chile y tipo crédito
- **THEN** el preview muestra el arte de crédito de Banco de Chile con los datos ingresados

#### Scenario: Últimos 4 dígitos siempre obligatorios
- **WHEN** el usuario intenta crear una tarjeta sin los últimos 4 dígitos
- **THEN** la creación se bloquea hasta ingresar exactamente 4 dígitos numéricos

#### Scenario: Tipos sin tarjeta no se ofrecen a mano
- **WHEN** el usuario abre "Nueva tarjeta"
- **THEN** solo puede elegir tipos con tarjeta (débito/crédito); ahorro y billetera no aparecen (llegan por Fintoc)
