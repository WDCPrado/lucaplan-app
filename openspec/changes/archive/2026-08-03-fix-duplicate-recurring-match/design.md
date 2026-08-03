## Context

`confirmFromMovement` (application) elige **una** plantilla con `pickTemplateFor` (domain, puro) y
llama `attachImportedMovement` (infra). `attachImportedMovement` es atómico y devuelve `false` si
el período de esa plantilla ya está confirmado. El import recorre los movimientos uno a uno
(`matchRecurringForImported`), sin estado compartido entre iteraciones. `pickTemplateFor` es
determinista: con dos candidatas equivalentes gana siempre la misma → el segundo cargo choca con un
período ya confirmado y, como `confirmFromMovement` no reintenta, queda huérfano.

## Goals / Non-Goals

**Goals:**
- Repartir cargos equivalentes entre plantillas equivalentes, sin cargos huérfanos ni comprometidos
  colgados.
- Mantener la prioridad actual (rango más estrecho → monto más cercano) para elegir el orden.

**Non-Goals:**
- No cambiar el criterio de qué plantilla matchea (mismo texto + rango + moneda + dirección).
- No hacer el match de todos los cargos "a la vez" (asignación global óptima). El greedy secuencial
  basta: con candidatas equivalentes, cuál va a cuál es indistinto.

## Decisions

### D1 — `rankTemplatesFor` en el dominio, `pickTemplateFor` como su cabeza
Se extrae `rankTemplatesFor(movement, templates): RecurringTemplate[]` con la lógica de orden actual
(filtra por `matchesTemplate`, ordena por ancho de rango y luego por cercanía de monto).
`pickTemplateFor` pasa a ser `rankTemplatesFor(...)[0] ?? null`. Sin cambio de comportamiento para
sus usos actuales (incluidos sus tests). Alternativa descartada: meter el estado del período en el
dominio → rompería su pureza.

### D2 — `confirmFromMovement` itera hasta que un attach tome
En vez de un solo `pickTemplateFor` + attach, itera `rankTemplatesFor` en orden y hace `attach` en
cada candidata; la **primera que devuelve `true`** gana y corta. Si todas devuelven `false` (todos
los períodos ya confirmados), devuelve `null` (flujo normal). El estado de "período consumido" lo
resuelve `attachImportedMovement` mismo (rebota si ya está confirmado), así que no hace falta
consultar estado aparte ni compartirlo entre iteraciones del import: cada attach ve la BD ya
actualizada por el cargo anterior.

## Risks / Trade-offs

- **N attachs por cargo en el peor caso** (varias candidatas rebotando) → intrascendente: las
  candidatas por cargo son 1-2 en la práctica, y cada attach es una transacción corta.
- **Orden de llegada de los cargos** define a qué plantilla va cada uno cuando son equivalentes →
  aceptable: son indistinguibles, lo único que importa es que cada comprometido se consuma una vez.

## Migration Plan

Sin datos ni schema: solo lógica. Deploy directo. Rollback = revertir el commit.

## Open Questions

- Ninguna.
