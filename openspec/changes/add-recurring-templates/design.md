## Context

`Income` ya resolvió "plantilla que materializa `Transaction` de forma idempotente" para el
lado de los ingresos (`income.domain.ts` + `income-use-cases.ts` + gancho `incomeId`). Los
gastos recurrentes necesitan lo mismo, pero con dos diferencias: llegan por el correo del
banco (no se generan a mano) y el monto varía de un mes a otro dentro de un rango.

El import de correo hoy termina llamando a `deps.categorize(userId)` en
`email-connection-use-cases.ts`; la categorización por IA excluye lo que ya tiene categoría
y lo que no está `confirmed` (`categorize-pending-filter.ts`). El presupuesto suma solo
`confirmed` (`budget-formulas.ts`). Ambas cosas se aprovechan tal cual.

Este cambio es además la base de ejecución del plan de cuotas (WDC-25): ahí una compra en
cuotas es una plantilla en modo `cron`.

## Goals / Non-Goals

**Goals:**
- Que un gasto conocido aparezca en el presupuesto del mes antes de cobrarse.
- Que los gastos recurrentes no consuman IA ni ensucien el triage.
- Un único runner de cron, seguro, reutilizable por las cuotas.

**Non-Goals:**
- Detectar recurrencias solas a partir del historial.
- Intereses, prorrateos o cualquier cálculo bancario.
- Gastos recurrentes sin banco conectado (el issue los deja fuera).

## Decisions

### El comprometido es una `Transaction` `pending`, no un modelo de reserva

**Decisión:** la plantilla materializa la transacción del período con `status="pending"` y
el cobro real la **confirma** (mismo id, monto y fecha reales).

**Por qué:** el estado `pending` ya existe en `Transaction` y ya está excluido del
presupuesto, de la caja y de la IA. Sumar comprometido = una query más sobre movimientos
que ya se cargan. La alternativa (campo `reservesBudget` + suma de plantillas activas sin
ejecución) obliga a razonar sobre dos fuentes distintas en cada fórmula y a resolver el
"consumo" de la reserva a mano; con `pending` el consumo es un `UPDATE` de estado, y no hay
forma de doble-contar. Coste: el requisito canónico de "estados del movimiento" gana una
segunda razón para que un movimiento esté `pending` (proveedor / plantilla) — se documenta
en el delta de `finance-model`.

### El match vive en el dominio, la orquestación en el import

Regla pura en `recurring.domain.ts`: `matchesTemplate(movement, template)` = descripción
normalizada igual (`normalizeMovementText`, el mismo de categorization-learning) **y** monto
en `[base·(1−tol), base·(1+tol)]` **y** misma moneda y dirección. Testeable sin IO. El
use-case de import la aplica sobre los movimientos nuevos **antes** de `deps.categorize`.
Empate entre plantillas → gana el rango más estrecho (la más específica).

### Sin proceso de fondo: los períodos se abren al mirarlos

El diseño original tenía un cron (`POST /api/cron/recurring/run`) con guard de red privada.
Se retiró: **nadie lo necesitaba**. El comprometido se materializa al consultarse el mes
(idempotente por el único de BD), el cargo real lo reconoce el import de correo, y las
cuotas de WDC-25 se ejecutan cuando llega el pago de la tarjeta — un hecho del banco, no una
fecha de calendario. Un runner desplegado que no cambia ningún resultado es infraestructura
que hay que monitorear a cambio de nada.

La idempotencia sigue siendo del índice único `(recurringTemplateId, periodKey)`: la impone
la base, no una comprobación previa sujeta a carrera.

### Periodicidad con `periodKey` derivado

`monthly` → `YYYY-MM`, `yearly` → `YYYY`, `biweekly` → índice de quincena desde
`startDate`. Función pura en el dominio; es la clave de idempotencia y la que resuelve el
día 31 en meses cortos (se ancla al último día del mes).

## Risks / Trade-offs

- **Match errado confirma el comprometido equivocado** → tolerancia por plantilla,
  desempate por rango más estrecho, y el usuario puede desvincular/editar el movimiento
  desde la vista.
- **Comprometidos que nunca se cobran** (plantilla obsoleta, comercio que cambió de
  descripción) → quedan `pending` acumulados inflando el comprometido; la vista de
  recurrentes muestra "última confirmada" para detectarlas, y el usuario desactiva o
  elimina la plantilla. No se auto-limpian en esta versión.
- **Si nadie abre la app en todo el mes, el comprometido no se crea** → tampoco hay quien lo
  mire; al entrar se materializa al instante, y el reconocimiento del cargo real no depende
  de que exista previamente.
- **Doble semántica de `pending`** (proveedor vs. plantilla) → se distingue por
  `recurringTemplateId`, y ningún cálculo actual necesita distinguirlas.

## Migration Plan

1. Migración: tabla `RecurringTemplate`, columna `recurringTemplateId` + índice en
   `Transaction`, índice único `(recurringTemplateId, periodKey)`.
2. Deploy de la app (sin plantillas creadas el comportamiento es idéntico al actual).

Sin variables ni servicios nuevos. Rollback: desactivar las plantillas; los movimientos
`pending` quedan sin efecto sobre los cálculos existentes.

## Open Questions

- ¿Se limpia automáticamente el comprometido de períodos ya vencidos sin cobro, o se deja
  siempre a decisión del usuario?
