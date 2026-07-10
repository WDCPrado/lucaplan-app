# Proposal: budget-cap-and-category-modal-ux

## Why

Hoy los límites por categoría suman un total de presupuesto, pero nada controla ese total: el
usuario no sabe cuánto puede presupuestar en el mes ni cuánto le queda por asignar al crear o
editar categorías. Además, el modal de crear/editar categoría creció por acumulación (nombre,
tipo, descripción IA, 32 iconos, límite, color nativo) y hoy es ruidoso: los campos importantes
(límite) quedan enterrados, el selector de color es un `<input type="color">` nativo que rompe el
design system, y no hay vista previa de cómo quedará la categoría.

## What Changes

- **Nueva entidad: presupuesto del mes (`monthly_budget`) con su límite global.** El presupuesto
  del mes pasa a existir como tabla (una fila por usuario + `year` + `month`) y nace con un solo
  campo: `globalLimit`, que define cuánto puede presupuestarse en total entre las categorías de
  ese mes. Las categorías **no** se le asocian por FK: siguen siendo globales con límites por mes
  y carry-forward, exactamente como hoy. Misma semántica de herencia para el límite global: el
  mes sin registro hereda el último previo; sin ninguno, no hay límite global definido.
- **Script de migración con `--db`**: aplicar la migración eligiendo la base de datos por consola
  (parámetro `--db <DATABASE_URL>`), para controlar cuándo se migra local y producción.
- **Nuevo cálculo derivado: restante por presupuestar** = cap efectivo del mes − Σ límites
  efectivos de las categorías de **gasto**. Puede ser negativo (sobre-asignado ⇒ alerta). Se
  calcula al vuelo, no se persiste — igual que uso/disponible.
- **UI de Presupuestos (dashboard): cabecera con el cap.** Arriba de los anillos se muestra el
  cap del mes, lo asignado y el **restante por presupuestar**; el cap se define/edita en un modal
  shadcn (money input CLP). Sin cap definido, la cabecera invita a definirlo.
- **Rediseño del modal de categoría** (crear/editar), respetando el design system:
  - Vista previa en vivo (anillo + icono + color + nombre) como aparecerá en Presupuestos.
  - Campos reagrupados por intención: identidad (nombre + tipo) → presupuesto (límite) →
    apariencia (icono + color) → descripción IA (colapsable, al final).
  - El campo límite muestra como ayuda el restante por presupuestar del mes.
  - Selector de color con **paleta de swatches** (tokens del design system) en vez del
    `<input type="color">` nativo.
- **API**: la vista de presupuestos (`GET /api/budgets`) expone cap, asignado y restante; nuevo
  endpoint de escritura del cap del mes.

**Fuera de alcance** (explícito del usuario): sueldo / fuentes de ingreso del usuario. Se hará
después como N fuentes de ingreso relacionadas a transacciones de ingreso; este cambio no toca
nada de eso.

## Capabilities

### New Capabilities

(ninguna — todo cae en capacidades existentes)

### Modified Capabilities

- `budget-planning`: nuevo requirement del presupuesto del mes (`monthly_budget`) con límite
  global y carry-forward, y nuevo derivado "restante por presupuestar" (límite global − Σ límites
  de gasto), calculado al vuelo.
- `finance-api`: la lectura de presupuesto incluye límite global/asignado/restante; nueva
  escritura del presupuesto del mes (upsert por usuario+año+mes).
- `finance-ui`: cabecera de Presupuestos con límite global y restante por presupuestar (+ modal
  para definirlo); rediseño del modal de categoría (vista previa, agrupación de campos, swatches
  de color, ayuda de restante en el límite).

## Impact

- **Prisma**: nuevo modelo `MonthlyBudget` (tabla `monthly_budget`: userId, year, month,
  globalLimit) + migración. Sin cambios a modelos existentes.
- **Dominio** (`arch/v1/domain/finance/finance.domain.ts`): entidad `MonthlyBudget`, input de
  escritura y port `MonthlyBudgetRepository`.
- **Application**: `budget-formulas.ts` (límite global efectivo con carry-forward reutilizando la
  lógica de `effectiveLimit`; restante por asignar), `finance-read.ts` (extender `BudgetViewDTO`),
  nuevo use-case de escritura del presupuesto del mes.
- **Infrastructure**: `finance.infrastructure.ts` implementa el repo del presupuesto del mes.
- **Presentation**: `app/api/budgets/route.ts` (GET extendido + POST del presupuesto del mes).
  Dashboard (`components/finance/dashboard.tsx`) y `category-modal.tsx` rediseñado.
- **Scripts**: script de migración con parámetro `--db <DATABASE_URL>` (patrón de
  `scripts/setup-db.mjs`) para aplicar `prisma migrate deploy` a la base elegida.
- **Tests**: fórmulas y use-cases con `node --test` (fakes existentes en `finance.test.ts`).
