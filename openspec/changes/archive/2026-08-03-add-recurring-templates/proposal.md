## Why

Los gastos que se repiten todos los meses (arriendo, gasto común, suscripciones) hoy se
tratan como cualquier movimiento: llegan por correo, pasan por la IA y hay que revisarlos,
aunque el usuario ya sabe de antemano que van a llegar y a qué categoría pertenecen. Eso
gasta llamadas de IA, ensucia el triage y — más importante — el presupuesto del mes no
refleja lo que ya está comprometido hasta que el cargo efectivamente aparece.

`Income` ya demostró el patrón (una plantilla que materializa `Transaction` de forma
idempotente, enganchada por `incomeId`). Esta es la versión para gastos, y además es la
base de ejecución que necesita el plan de cuotas (WDC-25).

## What Changes

- **Nueva entidad `RecurringTemplate`**: plantilla de gasto recurrente del usuario con
  descripción (clave de match), categoría heredada del movimiento origen, monto base,
  tolerancia (± % configurable, default 10), moneda, dirección, cuenta,
  periodicidad (`monthly` | `biweekly` | `yearly`), día de ejecución y `isActive`.
  Una plantilla ejecuta 0..N movimientos reales.
- **La transacción del período se materializa como `pending`** (no se inventa un modelo de
  "reserva" aparte): al abrirse el período, la plantilla activa crea su `Transaction` con
  `status="pending"`, monto base, categoría de la plantilla y `recurringTemplateId`. Es el
  gasto comprometido del mes.
- **Confirmación por detección de correo (`email_detection`, default)**: durante el import,
  **antes** de la IA, cada movimiento nuevo se compara contra las plantillas activas por
  descripción normalizada + monto dentro del rango de tolerancia. Si matchea, ese movimiento
  pasa a ser **la ejecución confirmada del período** (categoría de la plantilla, vinculado,
  `reviewed`) y el comprometido `pending` se consume: el período queda con un solo
  movimiento. **Prioridad: plantilla > corrección aprendida > IA.**
- **Sin proceso de fondo**: los períodos se abren al consultarse el mes (idempotente). No hay
  cron: el banco es quien avisa, y las cuotas (WDC-25) se ejecutan al llegar el pago de la
  tarjeta, no en una fecha de calendario.
- **Presupuesto con capa "comprometido"**: el uso de categoría sigue sumando solo
  `confirmed`; se agrega el comprometido del mes (Σ `pending` no internos), que la vista de
  presupuesto muestra como capa distinta del gastado real.
- **UI**: nueva ruta `/recurrentes` (ítem de nav, mismo patrón que `/perfil`) con la lista
  de plantillas, y botón "Hacer recurrente" en el modal de transacción que precarga
  descripción, monto base y categoría del movimiento.
- **Fuera de scope**: gastos recurrentes manuales sin banco, plan de cuotas (WDC-25),
  aprendizaje automático de recurrencias a partir del historial.

## Capabilities

### New Capabilities
- `recurring-templates`: plantillas de gasto recurrente, su materialización como
  movimiento `pending` del período, la confirmación por detección de correo o por cron, y
  la superficie de gestión.

### Modified Capabilities
- `finance-model`: `Transaction` gana el gancho `recurringTemplateId` y el estado `pending`
  adquiere semántica de negocio (gasto comprometido aún no cobrado).
- `budget-planning`: el presupuesto del mes distingue gastado (confirmado) de comprometido
  (pendiente).
- `finance-api`: nuevos contratos para el CRUD de plantillas.

La categorización por IA no cambia de requisito: como el match asigna categoría antes del
paso de IA, la regla vigente de "un movimiento que ya tiene categoría no se re-categoriza"
ya produce la precedencia buscada. El shell tampoco: su requisito no enumera destinos.

## Impact

- **Datos/Prisma**: modelo `RecurringTemplate`; columna `recurringTemplateId` nullable +
  índice en `Transaction`. Nueva migración.
- **Código**: `arch/v1/domain/finance/recurring.domain.ts` (entidad, port, regla de match
  pura); `recurring-use-cases.ts`; integración en
  `finance-use-cases/email-connection-use-cases.ts` (paso previo a `categorize`);
  `budget-formulas.ts` (comprometido); repo Prisma; vista `/recurrentes` y modal de
  transacción.
- **Infra**: ninguna. No hay runner ni variables nuevas.
- **Riesgo**: un match errado confirma una `pending` con el movimiento equivocado. Se
  acota con tolerancia por plantilla y con que el usuario puede desvincular/editar el
  movimiento.
