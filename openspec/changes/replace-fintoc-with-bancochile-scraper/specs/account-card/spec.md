## MODIFIED Requirements

### Requirement: Presentación de la tarjeta

La tarjeta SHALL renderizar el arte de fondo con un overlay de datos **dinámicos**: banco, últimos 4
dígitos reales (`•••• {cardLast4}`), badge de tipo, y los **saldos por bucket**:

- **Cuenta corriente**: el **saldo débito** (bucket `cash`) y, **si aplica**, el **saldo sobregiro**
  (bucket `overdraft`) destacado como deuda. Un saldo **negativo** (deuda / sobregiro usado) SHALL
  mostrarse con **color de alerta** (distinto del saldo positivo), no neutro como hasta ahora.
- **Tarjeta de crédito**: los cupos **nacional (CLP)** e **internacional (USD)** por separado
  (usado / disponible), sin sumar monedas.

Los datos dinámicos NO SHALL venir quemados en la imagen. Los últimos 4 dígitos SHALL ser los
**reales**, NO los del id interno.

#### Scenario: Cuenta corriente muestra débito y sobregiro
- **WHEN** una cuenta corriente tiene saldo débito y línea de sobregiro
- **THEN** la tarjeta muestra el saldo débito y, si aplica, el saldo sobregiro destacado como deuda

#### Scenario: Saldo negativo se colorea como deuda
- **WHEN** el saldo débito es negativo (sobregiro usado)
- **THEN** se muestra con color de alerta, no con el color neutro de un saldo positivo

#### Scenario: Tarjeta de crédito muestra ambos cupos
- **WHEN** una tarjeta de crédito tiene cupo nacional (CLP) e internacional (USD)
- **THEN** la tarjeta muestra ambos cupos por separado, sin sumar CLP con USD

## ADDED Requirements

### Requirement: Agrupación de tarjetas de una misma cuenta

Las **tarjetas de crédito de una misma cuenta** SHALL mostrarse **juntas** (agrupadas visualmente
bajo su cuenta), de modo que se lean como un solo producto con sus tarjetas/cupos, en vez de
tarjetas sueltas sin relación.

#### Scenario: Dos tarjetas de la misma cuenta se agrupan
- **WHEN** una cuenta de crédito tiene dos tarjetas
- **THEN** ambas se muestran agrupadas bajo esa cuenta, no como elementos independientes dispersos

#### Scenario: Cupos de una tarjeta se muestran juntos
- **WHEN** una tarjeta tiene cupo nacional e internacional
- **THEN** ambos cupos se presentan juntos como parte de esa tarjeta

### Requirement: Distintivo de cuenta conectada (banco local)

Una cuenta/tarjeta de origen `bancochile` SHALL mostrarse con un **distintivo de "conectado"** y una
acción de **sincronizar**, y SHALL renderizarse como **solo lectura** (sin editar ni agregar
movimientos a mano). El resto de su presentación sigue las reglas de tarjeta existentes.

#### Scenario: Cuenta conectada muestra distintivo y sincronizar
- **WHEN** una cuenta tiene origen `bancochile`
- **THEN** su tarjeta muestra el distintivo de "conectado" y ofrece sincronizar, sin acciones de edición manual
