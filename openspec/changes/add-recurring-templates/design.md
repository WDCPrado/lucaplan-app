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

### Un solo endpoint de cron para todo

`POST /api/cron/recurring/run` hace las dos cosas del día: abrir períodos (materializar
`pending`) y confirmar las plantillas `cron` que vencen. Idempotente por (plantilla,
período), que se implementa con un índice único `(recurringTemplateId, periodKey)` sobre la
transacción generada — la idempotencia la impone la base, no una comprobación previa
sujeta a carrera.

**Acceso:** el aislamiento real lo da la red privada de Railway (namespaced por
proyecto+entorno); un hostname `*.railway.internal` o una IP "local" son falsificables y
por eso no son criterio. El guard `requireInternal(req)` rechaza toda request con señales
de haber entrado por el edge público (cabeceras que inyecta el proxy) y exige `CRON_KEY`
como segunda capa. La app debe escuchar en `::` para recibir el tráfico privado.

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
- **La señal exacta de "vino del edge público" en Railway** depende del proxy → se aísla en
  `requireInternal` con test propio; si la señal cambia, se corrige en un solo lugar y
  `CRON_KEY` sostiene mientras tanto.
- **Doble semántica de `pending`** (proveedor vs. plantilla) → se distingue por
  `recurringTemplateId`, y ningún cálculo actual necesita distinguirlas.

## Migration Plan

1. Migración: tabla `RecurringTemplate`, columna `recurringTemplateId` + índice en
   `Transaction`, índice único `(recurringTemplateId, periodKey)`.
2. Deploy de la app (sin plantillas creadas el comportamiento es idéntico al actual).
3. Variables: `CRON_KEY`; app escuchando en `::`.
4. Función de cron en Railway apuntando al endpoint por la red privada.

Rollback: desactivar la función de cron y las plantillas; los movimientos `pending`
quedan sin efecto sobre los cálculos existentes.

## Open Questions

- ¿Se limpia automáticamente el comprometido de períodos ya vencidos sin cobro, o se deja
  siempre a decisión del usuario?
