## Context

Backend: clean arch versionada, Prisma 7 / Postgres, Better Auth. El dominio finance ya tiene
entidades, ports, `Money` y fórmulas puras (`budget-formulas.ts`), pero **sin adapters reales, sin
API, sin UI**. Auth resuelve el actor con `sessionGateway.getActor(headers)`; `proxy.ts` hace el
chequeo optimista de cookie. UI: Next 16 App Router, shadcn/ui + Base UI, Tailwind v4, tokens en
`app/globals.css` (design-system azul/slate con dark mode y glass). Referencia visual: 5 capturas de
una app dark mobile-first (anillos, tarjetas, chips, bottom nav).

## Goals / Non-Goals

**Goals:**
- Adapters Postgres para los 4 ports (map `Decimal` ↔ `Money`).
- Use-cases lectura (resumen, presupuestos, movimientos, detalle categoría) y escritura (crear
  transacción; crear/editar presupuesto y categorías).
- Route Handlers autenticados con ownership por `userId`.
- Migración: `icon`/`color` en categoría, `color` en cuenta.
- UI real (ruta protegida): Resumen, Presupuestos, Agregar transacción, Detalle de categoría, bottom nav.

**Non-Goals:**
- Parsers PDF, categorización con IA, tipo de cambio, historial de saldos.
- Pantallas de transfer/estadísticas/búsqueda (stubs en el nav).
- Paginación avanzada / búsqueda de movimientos.

## Decisions

- **Adapters en `infrastructure/database/prisma/<feature>.infrastructure.ts`.** Implementan los
  ports del dominio y mapean explícito Prisma `Decimal` (string) ↔ `Money.of(string, currency)`.
  El dominio nunca ve tipos de Prisma. Cierra la deuda "sin adapters reales".

- **Ports de escritura.** Se extienden los ports (o se agregan `...WriteRepository`) con
  `createTransaction`, `upsertBudget`, `upsertCategory`. Los use-cases de escritura reciben el
  `Actor` y validan ownership + reglas de negocio antes de tocar el repo.

- **Crear transacción = validar moneda + ajustar saldo (transacción atómica).** El use-case: (1)
  carga la cuenta, verifica `tx.currency === account.currency` (si no, error de dominio → 422); (2)
  crea la transacción; (3) ajusta `account.balance` (`credit` suma, `debit` resta). Pasos 2-3 en una
  transacción Prisma (`$transaction`) para no dejar saldo inconsistente. **ponytail:** el saldo se
  deriva del movimiento; no hay tabla de snapshots todavía.

- **Route Handlers finos.** `app/api/<recurso>/route.ts` parsea request → `getActor` → invoca
  use-case → mapea a HTTP (401 sin sesión, 404 ownership, 422 regla de negocio, 200/201 ok). Sin
  lógica de negocio en la ruta. Rutas: `GET /api/accounts`, `GET /api/summary`, `GET /api/budgets`
  (mes actual/param), `GET /api/categories/[id]`, `GET /api/transactions`, `POST /api/transactions`,
  `POST|PUT /api/budgets`, `POST|PUT /api/categories`.

- **UI en route group protegido** (p.ej. `app/(app)/`), server components para el fetch inicial
  (SSR con la sesión) + client components para interacción (tabs, selector de mes, hoja de agregar,
  toggle de ojo). Nada de `useEffect` para auth (lo cubre el proxy/redirect server-side) ni para
  datos iniciales (server component). Mutaciones vía `fetch` POST + `router.refresh()`.

- **Anillo de progreso = SVG propio** (círculo con `stroke-dasharray`), color por `CategoryStatus`
  mapeado a tokens (`success`/`warning`/`destructive`/`muted`). Es más simple que una dependencia de
  charts para un solo componente.

- **Tokens del design-system, layout de la referencia.** Se adopta el patrón visual del mockup
  (anillos, tarjetas, chips, bottom nav, dark) pero con los **tokens existentes** (azul/slate). El
  acento rosa/negro puro de la referencia queda como decisión abierta: si el usuario lo quiere, es un
  ajuste al design-system, no a esta UI. Montos con `.tabular` (mono + tabular-nums).

- **Componentes shadcn faltantes** (`sheet`/`drawer` para la hoja de agregar, `scroll-area`) se
  instalan con `pnpm dlx shadcn@latest add`; no se escriben a mano.

- **Crear/editar SIEMPRE en modal** (patrón de la referencia). Nada de pantallas de formulario
  aparte. Crear categoría = anillo **"+"** al final de los anillos → modal; editar categoría = tocar
  su anillo/detalle → modal; transacción y presupuesto igual. Un solo componente de modal por
  entidad, reusable para crear y editar (precarga valores en editar).

- **Deuda de sobregiro y de TC, separadas y por tarjeta.** Un `debit` en una cuenta ajusta su
  `balance` de forma uniforme (débito resta), pero la **deuda** se reporta distinto según el tipo:
  `computeOverdraftDebt` = Σ saldos negativos de cuentas `checking`; `computeCreditCardDebt` = deuda
  **por cada** cuenta `credit_card` (saldo negativo de esa tarjeta). No se suman en una cifra: el
  sobregiro es emergencia; la TC se usa y se paga en el ciclo. El **gasto con TC igual cuenta en el
  presupuesto del mes** (uso de categoría), independiente de cuándo se pague la tarjeta. La posición
  neta sigue usando solo la deuda de sobregiro (la TC se muestra aparte).

## Risks / Trade-offs

- **Saldo derivado del movimiento sin snapshots** → si se borra/edita una transacción el saldo
  puede desalinearse. MVP solo crea; editar/borrar es fase posterior. Documentado.
- **Consistencia saldo↔transacción** → mitigado con `$transaction` de Prisma.
- **Moneda transacción vs cuenta** → validada en el use-case (cierra la deuda del cambio anterior).
- **Divergencia visual con la referencia** (azul/slate vs negro/rosa) → marcada como decisión a
  confirmar; no bloquea.
- **Ownership** → cada use-case filtra por `actor.userId`; los GET por id devuelven 404 si no es del
  usuario (no 403, para no revelar existencia).

## Migration Plan

1. Migración Prisma: `category.icon String?`, `category.color String?`, `financial_account.color String?`.
2. Adapters Postgres de los 4 ports (+ métodos de escritura). Mapear Decimal ↔ Money.
3. Use-cases lectura + escritura; extender el seed con `icon`/`color`.
4. Route Handlers autenticados.
5. UI: shell + Resumen + Presupuestos + Agregar transacción + Detalle categoría + bottom nav.
6. Verificar: `pnpm typecheck`, `pnpm build`, tests de use-cases nuevos, y prueba manual del flujo
   (crear transacción → refresca resumen/presupuestos).
Rollback: revertir migración y borrar carpetas/archivos nuevos; el dominio y lo anterior quedan intactos.

## Open Questions

- **Acento visual:** ¿mantener azul/slate del design-system o virar a negro/rosa como la referencia?
  (decisión de design-system, se resuelve en revisión).

Resueltas: crear/editar siempre en modal (anillo "+" para crear categoría, tocar anillo para
editar); la TC sube la deuda de esa tarjeta, reportada aparte del sobregiro, y su gasto igual cuenta
en el presupuesto del mes.
