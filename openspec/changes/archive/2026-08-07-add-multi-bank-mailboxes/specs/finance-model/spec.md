## ADDED Requirements

### Requirement: La identidad externa de una cuenta importada incluye su banco

La identidad externa de una cuenta creada por una conexión automática SHALL ser única por usuario y
banco, e incluir el banco que la originó. Dos bancos distintos del mismo usuario SHALL poder tener
cuentas con el mismo número o los mismos últimos cuatro dígitos sin colisionar entre sí.

La identidad de los movimientos SHALL seguir siendo única dentro de su cuenta y SHALL NOT cambiar por
esta regla: un movimiento ya importado no se re-identifica.

#### Scenario: Dos bancos con los mismos últimos cuatro
- **WHEN** el usuario conecta dos bancos y ambos notifican una tarjeta terminada en los mismos cuatro dígitos
- **THEN** el sistema crea una cuenta por banco, sin colisión ni sobrescritura, y cada movimiento se imputa a la cuenta de su banco

#### Scenario: Movimientos existentes conservan su identidad
- **WHEN** las cuentas ya importadas adoptan la identidad externa que incluye su banco
- **THEN** sus movimientos siguen vinculados a la misma cuenta y una sincronización posterior no los duplica

### Requirement: El origen admite cualquier banco conectado

El origen (`provider`) de un banco, cuenta o movimiento SHALL admitir la clave de cualquier banco
soportado, y SHALL NOT estar limitado a un único banco conocido. Las superficies que distinguen una
cuenta conectada de una manual —para marcarla de solo lectura o mostrar su procedencia— MUST
decidirlo por "el origen no es manual" o por su método de conexión, y SHALL NOT comparar contra la
clave de un banco concreto.

#### Scenario: Cuenta de un banco recién soportado
- **WHEN** se importa una cuenta desde un banco distinto al primero soportado
- **THEN** la app la trata como cuenta conectada de solo lectura, igual que las del primero, sin que sus movimientos importados puedan editarse o borrarse a mano

#### Scenario: Cuenta manual
- **WHEN** el usuario crea una cuenta a mano
- **THEN** sigue siendo editable, sin importar qué bancos tenga conectados
