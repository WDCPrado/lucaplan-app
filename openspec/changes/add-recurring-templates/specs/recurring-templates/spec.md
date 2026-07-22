## ADDED Requirements

### Requirement: Plantilla de gasto recurrente

El sistema SHALL modelar el gasto recurrente como una entidad `RecurringTemplate` del
usuario: una plantilla que ejecuta 0..N movimientos reales. Cada plantilla SHALL tener
descripción (clave de match), una **categoría obligatoria**, monto base (`Money`), moneda,
dirección (`debit` | `credit`), tolerancia en porcentaje entero (default 10), periodicidad
(`monthly` | `biweekly` | `yearly`), día de ejecución, e `isActive`. La **cuenta es obligatoria**: es donde se
materializa el movimiento comprometido de cada período.

Todas las ejecuciones de una plantilla SHALL usar la categoría de la plantilla; el sistema
NO SHALL categorizar por IA un movimiento vinculado a una plantilla.

Un movimiento vinculado a una plantilla NO SHALL poder quedarse **sin categoría**: la plantilla
exige una y vaciarla dejaría al sistema con dos verdades. El sistema SHALL rechazar esa
operación y SHALL permitirla una vez eliminada la recurrencia. Del mismo modo, NO SHALL poder
crearse una plantilla desde un movimiento sin categoría.

La categoría fluye en **una sola dirección**: la manda el movimiento, no la plantilla. Cuando la
plantilla nació de un movimiento, su categoría NO SHALL editarse desde la plantilla; SHALL
mostrarse como heredada. Recategorizar un movimiento vinculado SHALL actualizar la categoría de
su plantilla y la de sus movimientos comprometidos aún no cobrados; los movimientos ya
confirmados NO SHALL cambiar de categoría (son historia de su mes).

#### Scenario: Plantilla creada desde un movimiento hereda su categoría
- **WHEN** el usuario convierte en recurrente un movimiento categorizado como "Vivienda"
- **THEN** la plantilla queda con categoría "Vivienda", descripción y monto base del movimiento

#### Scenario: Recategorizar el movimiento reencauza la plantilla
- **WHEN** el usuario cambia de "Vivienda" a "Servicios" la categoría de un movimiento vinculado a una plantilla
- **THEN** la plantilla y su comprometido aún no cobrado quedan en "Servicios", y los movimientos ya confirmados conservan "Vivienda"

#### Scenario: Un movimiento recurrente no puede quedar sin categoría
- **WHEN** el usuario intenta dejar sin categoría un movimiento vinculado a una plantilla
- **THEN** el sistema lo rechaza e indica que primero debe eliminar la recurrencia

#### Scenario: Al eliminar la recurrencia se libera la categoría
- **WHEN** el usuario elimina la recurrencia de ese movimiento y vuelve a editarlo
- **THEN** ya puede dejarlo sin categoría y volver a hacerlo recurrente si quiere

#### Scenario: No se crea una recurrente desde un movimiento sin categoría
- **WHEN** el usuario abre un movimiento sin categoría
- **THEN** no se ofrece hacerlo recurrente hasta que le asigne una

#### Scenario: La categoría no se edita desde la plantilla heredada
- **WHEN** el usuario abre una plantilla creada desde un movimiento
- **THEN** su categoría se muestra como heredada y no puede cambiarse ahí

#### Scenario: Plantilla sin categoría se rechaza
- **WHEN** se intenta crear una plantilla sin categoría
- **THEN** el sistema rechaza la creación

#### Scenario: La moneda la fija la cuenta
- **WHEN** se crea una plantilla sobre una cuenta en CLP
- **THEN** el monto base queda en CLP y solo matchean cargos en esa moneda

### Requirement: Movimiento comprometido del período

Al abrirse un período de una plantilla activa, el sistema SHALL materializar el gasto
esperado como una `Transaction` con `status="pending"`, el monto base de la plantilla, su
categoría, su cuenta, fecha en el día de ejecución del período y el vínculo
`recurringTemplateId`. Esa materialización SHALL ser **idempotente por (plantilla,
período)**: reprocesar el mismo período NO SHALL crear un segundo movimiento.

La materialización SHALL ocurrir sin proceso de fondo: al consultarse el mes
en curso o un mes futuro, el sistema SHALL abrir los períodos pendientes de las plantillas
activas del usuario. Los meses **pasados** NO SHALL materializarse (no se inventa historia hacia
atrás). El movimiento comprometido SHALL mostrarse en las listas de movimientos —del mes y de la
categoría— con una marca de estado que lo distinga de un cargo que el banco aún no confirma.

Las plantillas inactivas NO SHALL materializar movimientos. Desactivar una plantilla NO
SHALL borrar los movimientos ya confirmados.

#### Scenario: Se abre el período y aparece el comprometido
- **WHEN** empieza un período de una plantilla mensual activa de 350.000 CLP
- **THEN** existe una `Transaction` `pending` de 350.000 CLP en su categoría, vinculada a la plantilla

#### Scenario: Reprocesar el período no duplica
- **WHEN** el proceso de materialización corre dos veces sobre el mismo período de la misma plantilla
- **THEN** sigue existiendo exactamente un movimiento del período

#### Scenario: El comprometido aparece al abrir el mes
- **WHEN** el usuario abre el mes en curso y su plantilla activa aún no tiene movimiento del período
- **THEN** el período se materializa en ese momento y el comprometido aparece en el presupuesto y en la lista de movimientos

#### Scenario: Un mes pasado no materializa nada
- **WHEN** el usuario consulta un mes anterior al actual
- **THEN** no se crea ningún movimiento comprometido para ese mes

#### Scenario: El comprometido se distingue del pendiente del banco
- **WHEN** la lista muestra un movimiento comprometido por una plantilla y otro `pending` reportado por el banco
- **THEN** cada uno lleva una marca de estado distinta

#### Scenario: Plantilla inactiva no compromete nada
- **WHEN** el usuario desactiva una plantilla y empieza un período nuevo
- **THEN** no se materializa movimiento para ese período y los confirmados anteriores se conservan

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
exactamente **un** movimiento, con el monto y la fecha reales del cargo. Si en el período
hay varias plantillas candidatas, SHALL ganar la de rango más estrecho alrededor del monto;
si el período ya tenía ejecución confirmada, el movimiento nuevo SHALL seguir el flujo
normal (IA/triage) sin vincularse a la plantilla.

#### Scenario: El cargo real consume el comprometido
- **WHEN** llega por correo un cargo de 362.000 CLP con la descripción de una plantilla de base 350.000 y tolerancia 10%
- **THEN** el período queda con un único movimiento `confirmed` de 362.000 en la fecha del cargo, con la categoría de la plantilla, revisado y sin pasar por IA

#### Scenario: Monto fuera del rango no matchea
- **WHEN** llega un cargo de 500.000 CLP con la misma descripción de una plantilla de base 350.000 y tolerancia 10%
- **THEN** no se considera ejecución de la plantilla y el movimiento sigue el flujo normal de categorización

#### Scenario: Mismo comercio, dos plantillas por rango
- **WHEN** el usuario tiene "arriendo" (base 350.000) y "gasto común" (base 90.000) con la misma descripción y llega un cargo de 92.000
- **THEN** confirma el comprometido de "gasto común" y deja intacto el de "arriendo"

#### Scenario: Segundo cargo del mismo período no se vincula
- **WHEN** el comprometido del período ya fue confirmado y llega otro cargo que también cae en el rango
- **THEN** el movimiento nuevo no se vincula a la plantilla y pasa por el flujo normal de categorización

### Requirement: Periodicidad de la plantilla

El sistema SHALL soportar periodicidad `monthly`, `biweekly` y `yearly`. Para `monthly` y
`yearly` el período se identifica por el día de ejecución dentro del mes (o del mes del
año) y, cuando el mes no tiene ese día, SHALL usarse el último día del mes. Para
`biweekly`, el período SHALL avanzar cada 14 días desde la fecha de inicio de la plantilla.

#### Scenario: Día 31 en un mes de 30
- **WHEN** una plantilla mensual con día de ejecución 31 llega a un mes de 30 días
- **THEN** el período usa el día 30 como fecha de ejecución

#### Scenario: Plantilla quincenal
- **WHEN** una plantilla `biweekly` empezó el 1 de julio
- **THEN** sus períodos siguientes se abren el 15 de julio, el 29 de julio y así sucesivamente

### Requirement: Gestión de plantillas en la app

El sistema SHALL ofrecer una vista propia de recurrentes, accesible desde la navegación
principal, que liste las plantillas del usuario con descripción, categoría, monto base con
su rango de tolerancia, periodicidad, estado y la **fecha del próximo cobro esperado**.
Desde la vista el usuario SHALL poder crear, editar, activar/desactivar y eliminar
plantillas. Eliminar una plantilla NO SHALL borrar los movimientos ya confirmados; el
movimiento comprometido aún no confirmado SHALL eliminarse con ella.

El sistema SHALL además permitir crear una plantilla desde un movimiento existente. Esa acción
NO SHALL crear la plantilla directamente: SHALL abrir el mismo formulario de creación
precargado con descripción, monto base, moneda, dirección, cuenta, categoría y día del
movimiento, para que el usuario ajuste al menos título, tolerancia y periodicidad antes de
confirmar.

Al confirmarse, el movimiento origen SHALL quedar vinculado a la plantilla como la **ejecución
de su período**, con la categoría de la plantilla. Así el movimiento aparece marcado como
recurrente y el período no vuelve a materializar un comprometido por un gasto ya cobrado.

Un movimiento generado por una plantilla SHALL mostrarse marcado como recurrente en la lista
de movimientos. Al abrirlo, el sistema NO SHALL ofrecer crear otra plantilla desde él: SHALL
ofrecer **pausar/reanudar** su recurrencia y **eliminarla**, indicando si está pausada. Una
plantilla pausada NO SHALL materializar ni confirmar los períodos siguientes; los movimientos
ya cobrados se conservan intactos.

#### Scenario: Crear recurrente desde un movimiento pide confirmación
- **WHEN** el usuario abre un movimiento y elige "Hacer recurrente"
- **THEN** se abre el formulario precargado con descripción, monto base, cuenta, categoría y día, y la plantilla no existe hasta que el usuario confirma

#### Scenario: El movimiento origen queda como ejecución del período
- **WHEN** el usuario confirma la creación desde un cargo del 20 de julio en una plantilla mensual
- **THEN** ese movimiento queda vinculado a la plantilla con el período de julio, marcado como recurrente, y julio no materializa otro comprometido

#### Scenario: El movimiento recurrente se distingue en la lista
- **WHEN** el usuario mira la lista de movimientos y uno proviene de una plantilla
- **THEN** ese movimiento aparece marcado como recurrente junto a su icono de categoría

#### Scenario: Un movimiento recurrente no genera otra plantilla
- **WHEN** el usuario abre un movimiento que ya está vinculado a una plantilla
- **THEN** no se ofrece "Hacer recurrente"; se ofrece pausar/reanudar y eliminar la recurrencia

#### Scenario: Pausar detiene las ejecuciones siguientes
- **WHEN** el usuario pausa la recurrencia desde el movimiento y llega el período siguiente
- **THEN** no se materializa ni se confirma movimiento para ese período, y los ya cobrados se conservan

#### Scenario: Eliminar plantilla conserva el historial
- **WHEN** el usuario elimina una plantilla con 5 movimientos confirmados y 1 comprometido
- **THEN** los 5 confirmados se conservan sin vínculo y el comprometido se elimina
