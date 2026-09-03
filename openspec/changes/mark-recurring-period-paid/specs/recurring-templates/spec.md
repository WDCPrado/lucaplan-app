## ADDED Requirements

### Requirement: Marca manual del cobro del período

El sistema SHALL permitir al usuario declarar que el cobro del período en curso de una plantilla
**ya ocurrió**, sin esperar la notificación del banco. Marcarlo SHALL dejar el movimiento del
período en estado **confirmado**, de modo que cuente como gasto del mes igual que un cargo real; si
el período aún no tenía su movimiento comprometido, el sistema SHALL materializarlo en ese momento y
dejarlo confirmado, sin producir un segundo movimiento del período.

La marca SHALL crear el movimiento con el **monto base** de la plantilla y la fecha del día: el
monto y la fecha reales los fija el correo cuando llega.

La marca SHALL poder **deshacerse**, devolviendo el movimiento a comprometido del período. El
sistema SHALL rechazar deshacer un cobro que vino del banco: no es una afirmación del usuario sino
un cargo real, y revertirlo borraría un hecho.

La acción SHALL ofrecerse desde la **lista de recurrentes** —donde ya se indica el próximo cobro o
la marca de cobrado— y desde el **modal de la plantilla**. Las plantillas pausadas y las finalizadas
NO SHALL ofrecerla: no tienen período que cobrar.

La marca NO SHALL mover el saldo ni el cupo de la cuenta: en una cuenta conectada esa proyección la
hace el correo, única fuente de esa medición.

#### Scenario: Marcar pagado el cobro del mes
- **WHEN** el usuario marca pagado el cobro del período de una recurrente de 350.000 CLP cuyo comprometido está `pending`
- **THEN** ese movimiento queda confirmado por 350.000, cuenta como gasto del mes y la fila muestra la marca de "Cobrado"

#### Scenario: Marcar pagado un período que aún no se materializó
- **WHEN** el usuario marca pagado desde la lista de recurrentes y el período en curso todavía no tiene movimiento comprometido
- **THEN** el período se materializa en ese momento y queda confirmado, con un único movimiento

#### Scenario: Deshacer la marca
- **WHEN** el usuario deshace una marca manual
- **THEN** el movimiento del período vuelve a ser el comprometido `pending` y deja de contar como gasto del mes

#### Scenario: Un cobro del banco no se deshace desde ahí
- **WHEN** el usuario intenta deshacer el cobro de un período que ya fue confirmado por el cargo del correo
- **THEN** el sistema lo rechaza y el movimiento del banco se conserva intacto

#### Scenario: Una pausada no ofrece la marca
- **WHEN** el usuario mira una recurrente pausada o finalizada
- **THEN** la acción de marcar pagado no se ofrece

#### Scenario: Marcar pagado no toca el saldo
- **WHEN** el usuario marca pagado el cobro de una recurrente sobre una cuenta conectada
- **THEN** el saldo y el cupo de esa cuenta no cambian; solo cambia el gasto del mes

## MODIFIED Requirements

### Requirement: Confirmación por detección en el correo

Durante la importación de movimientos el sistema SHALL comparar
cada movimiento nuevo contra las plantillas activas del usuario **antes** de la
categorización por IA. Un movimiento SHALL considerarse match de una plantilla cuando su
descripción normalizada (misma normalización que usa la memoria de correcciones) coincide
con la de la plantilla **y** su monto cae dentro del rango
`[base × (1 − tolerancia), base × (1 + tolerancia)]`, en la misma moneda y dirección.

Ante un match, el movimiento importado SHALL pasar a ser **la ejecución confirmada del
período**: toma la categoría de la plantilla, queda vinculado a ella con la clave del
período y marcado como revisado (fuera del triage y de la IA), y el movimiento comprometido
`pending` de ese período SHALL consumirse. Terminado el proceso, el período SHALL tener
exactamente **un** movimiento, con el monto y la fecha reales del cargo.

Cuando el período ya tiene una ejecución **confirmada a mano** por el usuario, el cargo del correo
SHALL **reemplazarla**: la ejecución manual se elimina y el movimiento importado ocupa su lugar, con
su monto, su fecha y su identificador del banco. El correo es el hecho, y conservar las dos contaría
dos veces el mismo gasto. El reemplazo SHALL ser atómico: el período no SHALL quedar en ningún
momento con dos ejecuciones ni con ninguna.

Cuando la ejecución confirmada del período **vino del banco**, el cargo nuevo NO SHALL reemplazarla:
dos cargos reales del mismo período no se pisan, y el segundo sigue el flujo normal de
categorización.

Cuando en el período hay **varias plantillas candidatas**, el sistema SHALL ordenarlas por
prioridad —gana la de rango más estrecho alrededor del monto; a igualdad de rango, la de monto
base más cercano— e intentar vincular el cargo en la **primera candidata cuyo período aún no
tenga ejecución confirmada**. Si la de mayor prioridad ya consumió su período (por un cargo
anterior de la misma tanda), el cargo SHALL pasar a la siguiente candidata disponible. Así, ante
**dos plantillas equivalentes** (misma descripción y precio igual o parecido), dos cargos del
mismo período SHALL repartirse **uno a cada plantilla** en vez de dejar el segundo sin vincular.
Si todas las candidatas ya tienen su período confirmado, el movimiento nuevo SHALL seguir el
flujo normal (IA/triage) sin vincularse a ninguna.

#### Scenario: El cargo real consume el comprometido
- **WHEN** llega por correo un cargo de 362.000 CLP con la descripción de una plantilla de base 350.000 y tolerancia 10%
- **THEN** el período queda con un único movimiento `confirmed` de 362.000 en la fecha del cargo, con la categoría de la plantilla, revisado y sin pasar por IA

#### Scenario: El cargo real reemplaza la marca manual
- **WHEN** el usuario marcó pagado el período por 350.000 y días después llega por correo el cargo real de 362.000 de esa plantilla
- **THEN** el período queda con un único movimiento: el del banco, por 362.000 y con su fecha real; la marca manual se eliminó

#### Scenario: El cargo del banco no se reemplaza
- **WHEN** el período ya fue confirmado por un cargo del correo y llega otro cargo que también cae en el rango
- **THEN** el primero se conserva y el nuevo sigue el flujo normal de categorización

#### Scenario: Monto fuera del rango no matchea
- **WHEN** llega un cargo de 500.000 CLP con la misma descripción de una plantilla de base 350.000 y tolerancia 10%
- **THEN** no se considera ejecución de la plantilla y el movimiento sigue el flujo normal de categorización

#### Scenario: Mismo comercio, dos plantillas por rango
- **WHEN** el usuario tiene "arriendo" (base 350.000) y "gasto común" (base 90.000) con la misma descripción y llega un cargo de 92.000
- **THEN** confirma el comprometido de "gasto común" y deja intacto el de "arriendo"

#### Scenario: Dos plantillas equivalentes reparten un cargo a cada una
- **WHEN** el usuario tiene dos recurrentes con la misma descripción y el mismo precio (dos gimnasios) y llegan sus dos cargos del mes
- **THEN** cada cargo queda vinculado a una plantilla distinta, cada comprometido `pending` se consume, y ningún cargo queda huérfano ni pasa por IA

#### Scenario: Segundo cargo del mismo período no se vincula si no hay plantilla libre
- **WHEN** el comprometido del período de la única plantilla candidata ya fue confirmado y llega otro cargo que también cae en el rango
- **THEN** el movimiento nuevo no se vincula a la plantilla y pasa por el flujo normal de categorización
