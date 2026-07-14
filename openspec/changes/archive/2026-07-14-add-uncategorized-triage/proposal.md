## Why

Los movimientos sincronizados del banco a veces quedan sin categoría (la IA no siempre alcanza
o falla), y hoy hay que descubrirlos uno a uno en la lista. Sin categoría no cuentan bien en el
presupuesto, así que el usuario necesita un flujo rápido y persistente para ponerse al día al
abrir la app.

## What Changes

- Al cargar el dashboard se buscan **siempre** las transacciones sin categoría del usuario
  (todos los meses, no solo el visible) y, si hay, aparece una superficie de **triage**: un
  stack de cards animado (una card por transacción, con la info del detalle de movimiento).
- En cada card se elige la categoría (chips como en el modal de transacción); al elegir, se
  persiste (`PATCH /api/transactions/:id/category`, ya existe) y la card **vuela hacia arriba**
  apilándose en el montón de "hechas".
- **Deshacer**: arrastrar hacia abajo (o botón) recupera la última card categorizada para
  corregir la categoría (re-PATCH).
- La superficie es descartable (no bloquea la app) y reaparece en la próxima carga mientras
  queden movimientos sin categoría.
- La elección manual prevalece si la IA categoriza en paralelo; la escritura de IA solo actualiza
  filas que sigan con `categoryId = null`.
- Responsive: escritorio (~1440px) y móvil (~375px), con animaciones de resorte/transform
  (CSS + pointer events; sin dependencias nuevas).

## Capabilities

### New Capabilities

- `uncategorized-triage`: flujo de triage de movimientos sin categoría al abrir la app —
  detección al cargar, stack de cards con selección de categoría, apilado animado y deshacer.

### Modified Capabilities

- `finance-api`: nueva lectura "transacciones sin categoría del usuario" (query cross-mes que
  excluye reversados/duplicados e internos), expuesta al dashboard vía server component.

## Impact

- **Domain**: `TransactionSearchFilters` gana filtro `uncategorized` y el repositorio expone una
  asignación condicional para la IA (`categoryId` debe seguir nulo).
- **Application**: nueva lectura `listUncategorized` en `finance-read.ts`.
- **Infrastructure**: implementación Prisma del filtro (where `categoryId: null`).
- **Presentation/UI**: `app/dashboard/page.tsx` carga las sin categoría; componente nuevo
  `components/finance/uncategorized-triage.tsx` (stack de cards sobre el `Dialog` existente); se
  monta desde `Dashboard`, que pausa el auto-refresh mientras el triage está abierto.
- Sin migraciones de DB ni dependencias nuevas. El PATCH de categoría existente se reutiliza.
