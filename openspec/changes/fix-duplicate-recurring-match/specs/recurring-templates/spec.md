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
