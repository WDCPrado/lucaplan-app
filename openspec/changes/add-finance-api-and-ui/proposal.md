## Why

El dominio financiero (bancos, cuentas, presupuestos, categorías, transacciones + fórmulas) ya
existe, pero es puro: no hay adapters reales, ni API, ni UI. Esta feature lo pone en manos del
usuario: **endpoints reales sobre Postgres** y la **primera UI** — una app de finanzas mobile-first
moderna (dark) con pestañas Resumen/Presupuestos, anillos por categoría, detalle de categoría y una
hoja para agregar transacciones. Cierra además la deuda pendiente: validar la moneda del movimiento
contra su cuenta al escribir.

## What Changes

- **Adapters Postgres** que implementan los ports del dominio (`Bank`, `Account`, `Budget`,
  `Transaction` repositories), mapeando Prisma `Decimal` ↔ `Money`. Cierra "sin adapters reales".
- **Use-cases de lectura**: resumen mensual (caja activa, posición neta, ingresos/gastos/total
  presupuestado), vista de presupuestos (anillos con estado por categoría), lista de movimientos,
  detalle de categoría (uso/disponible + movimientos del mes).
- **Use-cases de escritura**: crear transacción (valida moneda vs. cuenta, deriva dirección, ajusta
  saldo de la cuenta), y crear/editar presupuesto del mes y sus categorías.
- **Route Handlers** (`app/api/…`) para cada uno, protegidos por sesión (`sessionGateway.getActor`),
  con ownership por `userId`.
- **Campos de presentación** (migración chica): `icon` (emoji) y `color` en `categories`; `color`
  en `financial_accounts` (para la tarjeta). Necesarios para los anillos y tarjetas del mockup.
- **Primera UI** (ruta real protegida, mobile-first, dark): selector de mes + pestañas
  **Resumen** (tarjetas de cuenta, saldo/caja, ingresos/gastos/presup., movimientos) y
  **Presupuestos** (anillos por categoría con estado, movimientos), **hoja Agregar transacción**
  (monto −/+, título, fecha, cuenta, chips de categoría), y **Detalle de categoría**. Bottom nav.
  Usa los tokens del design-system y `font-mono`/`tabular-nums` para montos.

## Capabilities

### New Capabilities

- `finance-api`: endpoints HTTP autenticados de lectura/escritura financiera + adapters Postgres.
- `finance-ui`: las pantallas de la app (Resumen, Presupuestos, Agregar transacción, Detalle de
  categoría) y su interacción, mobile-first.

### Modified Capabilities

- `finance-model`: agrega campos de presentación a categorías (`icon`, `color`) y a cuentas
  (`color`), sin cambiar las invariantes existentes.
- `budget-planning`: agrega la deuda de tarjeta de crédito **por tarjeta**, reportada separada de la
  deuda de sobregiro (no se suman; distinto peso). El gasto con TC sigue contando en el presupuesto
  del mes.

## Impact

- **Código nuevo:** `arch/v1/infrastructure/database/prisma/*.infrastructure.ts` (repos),
  `arch/v1/application/finance-use-cases/*` (read/write), `app/api/…/route.ts`, UI en ruta real
  (p.ej. `app/(app)/…`), componentes (anillo SVG, sheet). Migración para `icon`/`color`.
- **Design system:** la referencia es negro/rosa; se adopta su *layout* pero con los **tokens
  existentes** (azul/slate dark) salvo que el usuario pida virar el acento. A confirmar en revisión.
- **Fuera de alcance:** parsers de cartola PDF, categorización con IA, tipo de cambio, historial de
  saldos, pantallas de transferencia/estadísticas/búsqueda del bottom nav (stubs), paginación
  avanzada.
- **Dependencias:** posibles componentes shadcn (`sheet`/`drawer`, `scroll-area`) vía `pnpm dlx
  shadcn@latest add`. Sin otras deps npm.
