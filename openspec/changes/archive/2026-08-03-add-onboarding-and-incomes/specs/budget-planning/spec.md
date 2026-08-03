## MODIFIED Requirements

### Requirement: Presupuesto del mes con límite global

El presupuesto de un mes SHALL existir como entidad propia (`monthly_budget`): una fila por
(usuario, `year`, `month`) con su **límite global** (`globalLimit`), el monto único que define
cuánto puede presupuestarse en total entre las categorías de gasto de ese mes. Las categorías NO
SHALL asociarse por FK al presupuesto: siguen siendo globales del usuario, con límite por mes y
carry-forward (el presupuesto no las contiene; las agrupa por mes de forma derivada).

El límite global efectivo de un mes SHALL resolverse con carry-forward, igual que los límites de
categoría: el registro de ese mes si existe; si no, el del mes anterior más reciente. Sin ningún
registro previo, el límite global SHALL considerarse **no definido** (distinto de 0). La escritura
SHALL ser upsert por (usuario, año, mes).

El comportamiento del `globalLimit` (editable a libertad por el usuario, con carry-forward)
NO SHALL cambiar. Adicionalmente, las fuentes de ingreso activas SHALL poder **sembrar** el
`globalLimit`: cuando el mes en curso aún no tiene un `globalLimit` definido (ni propio ni
heredado), el sistema SHALL materializar el `globalLimit` como la suma de los montos de las
fuentes de ingreso activas del usuario, vía el mismo upsert por (usuario, año, mes). Esta
siembra es solo un valor inicial: no introduce una fuente de verdad distinta ni una atadura.

Cuando el mes **ya tiene** un `globalLimit` definido y el usuario edita o agrega fuentes de
ingreso, el sistema NO SHALL sobrescribir el `globalLimit` automáticamente. En su lugar MAY
sugerir al usuario actualizarlo al nuevo total de ingresos; la actualización SHALL requerir
una acción explícita del usuario.

#### Scenario: Definir el límite global del mes

- **WHEN** el usuario define 500.000 CLP como límite global de julio 2026
- **THEN** el presupuesto de julio 2026 tiene límite global efectivo de 500.000

#### Scenario: Mes sin registro hereda el último previo

- **WHEN** el usuario definió 500.000 en julio y no ha registrado nada para agosto
- **THEN** el límite global efectivo de agosto es 500.000 (carry-forward)

#### Scenario: Sin ningún registro no hay límite global

- **WHEN** el usuario nunca ha definido un límite global
- **THEN** el límite global efectivo es "no definido" y no se deriva restante por presupuestar

#### Scenario: Ingresos siembran el límite global cuando no está definido

- **WHEN** el mes en curso no tiene `globalLimit` definido y el usuario tiene fuentes de ingreso activas que suman 900.000 CLP
- **THEN** el `globalLimit` del mes se siembra como 900.000 vía upsert por (usuario, año, mes)

#### Scenario: Editar ingresos no pisa un límite global ya definido

- **WHEN** el mes ya tiene `globalLimit` de 700.000 (definido a mano) y el usuario edita/agrega un ingreso que sube el total a 900.000
- **THEN** el `globalLimit` sigue en 700.000 y el sistema solo sugiere actualizarlo a 900.000, que el usuario aplica si quiere

#### Scenario: El usuario mantiene la libertad de ajustar el límite

- **WHEN** el `globalLimit` fue sembrado desde los ingresos y el usuario lo cambia manualmente a otro valor
- **THEN** el valor manual prevalece y se propaga por carry-forward a los meses siguientes como cualquier otro límite
