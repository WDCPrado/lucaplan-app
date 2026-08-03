## Why

Un usuario puede tener **dos suscripciones distintas con el mismo comercio y precio igual o casi
igual** (dos gimnasios, dos planes). Cada una es una plantilla recurrente propia y cada mes genera
su propio cargo. Hoy el reparto falla: el primer cargo consume una plantilla y el segundo queda
**huérfano** (sin marca de recurrente, pasa por la IA) mientras la segunda plantilla se queda con
su comprometido `pending` sin consumir todo el mes. No se duplica el cobro, pero la detección no
reparte.

La causa: `pickTemplateFor` elige siempre la misma candidata (desempate determinista) y
`confirmFromMovement` no reintenta con otra cuando `attachImportedMovement` rebota porque el
período de esa plantilla ya está confirmado.

## What Changes

- El match pasa a ser **greedy por período**: ante varias plantillas candidatas para un cargo, se
  intentan **en orden** y se vincula en la **primera cuyo período aún no esté consumido**. Así dos
  cargos iguales caen uno en cada plantilla.
- Se extrae `rankTemplatesFor(movement, templates)` en el dominio (las candidatas ordenadas por el
  mismo criterio de prioridad); `pickTemplateFor` pasa a ser su primer elemento (sin cambio de
  comportamiento para quien solo quiere una).
- `confirmFromMovement` itera las candidatas ordenadas hasta que un `attach` tome (o null si todas
  rebotan).

## Capabilities

### New Capabilities
<!-- Ninguna. -->

### Modified Capabilities
- `recurring-templates`: la regla de "Confirmación por detección en el correo" reparte un cargo a
  cada plantilla cuando varias comparten descripción y rango, en vez de dejar cargos huérfanos.

## Impact

- **Dominio**: `arch/v1/domain/finance/recurring.domain.ts` (`rankTemplatesFor` + `pickTemplateFor`).
- **Aplicación**: `recurring-use-cases.ts` (`confirmFromMovement` itera candidatas).
- **Tests**: `recurring.test.ts` (dominio y/o use-cases): caso de dos plantillas idénticas con dos
  cargos, ambos vinculados. Sin cambios de schema, API ni UI.
