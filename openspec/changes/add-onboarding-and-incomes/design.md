## Context

La conexión de correo (Outlook → Banco de Chile) ya está implementada de punta a punta:
OAuth con PKCE, escaneo sin persistir (`scanEmailCandidates`), snapshot de cuentas
(`SnapshotForm`), import atómico (`/api/email-connection/confirm`), overlay de progreso
(`lib/import-progress.ts` + `ImportProgressTimeline`), categorización IA
(`categorizeMovements`) y aprendizaje conversacional (`UncategorizedTriage` +
`CorrectionLearnStep`). Las categorías son globales por usuario (`Category`, con
`type=income|expense`) y el presupuesto es un `MonthlyBudget` con `globalLimit` y
carry-forward. No existe onboarding de primera vez ni entidad de ingresos; el `globalLimit`
solo se ingresa a mano. El proyecto sigue clean architecture en `arch/v1/` y NO usa
framer-motion (animaciones con CSS + `tailwindcss-animate`).

## Goals / Non-Goals

**Goals:**
- Un flujo fullscreen de primera conexión que orqueste los pasos existentes y termine con
  un presupuesto armado, con el mínimo código nuevo.
- Modelar ingresos como entidad (`Income`) para derivar el `globalLimit`.
- Dejar el gancho (`Transaction.incomeId`) para la recurrencia automática futura sin
  construirla ahora.

**Non-Goals:**
- Gmail / Google (solo Outlook).
- Recurrencia automática de ingresos y frecuencias distintas a mensual.
- Sueldo como concepto separado del límite global.
- Deep-linking o persistencia server-side del paso del onboarding.
- Rediseño de los componentes reutilizados (solo se les agrega un `onDone`/modo embebido).

## Decisions

### D1. Máquina de pasos client-side (no rutas, no wizard genérico)
`OnboardingFlow` es un componente fullscreen con estado local `step` que renderiza en
secuencia los componentes existentes. Cada sub-paso recibe `onDone(payload)`/`onBack`.
- **Por qué:** el flujo corre una vez por usuario; rutas dedicadas (`/onboarding/[step]`) o
  un motor de wizard configurable agregan andamiaje que no paga su costo (YAGNI).
- **Alternativas descartadas:** rutas server-side (recuperables/deep-linkables, pero nadie
  deep-linkea su onboarding); wizard genérico (abstracción especulativa para un solo
  wizard).

### D2. Trigger reutiliza la señal que ya existe
El gating se hace en `sync-bancochile-button.tsx`: si vuelve con `outlook=setup` y la
conexión no tiene `bankId`, monta `OnboardingFlow` en vez del modal normal. La señal
`!reconnected || !connection.bankId` ya la produce el callback OAuth.
- **Por qué:** cero lógica nueva de detección de "primera vez".

### D3. Refactor mínimo de componentes reutilizados
`UncategorizedTriage` y `SnapshotForm` hoy asumen que cierran contra el dashboard. Se les
agrega una prop `onDone` (o modo "embebido") para que el shell controle la transición, sin
tocar su lógica interna.
- **Por qué:** reutilizar sin duplicar; el cambio es de superficie (callback), no de
  comportamiento.

### D4. `Income` como entidad; categoría reutiliza `Category` (`type=income`)
Modelo `Income`: `id`, `userId`, `accountId` → `FinancialAccount` (cuenta destino, no de
crédito), `categoryId` → `Category` (`type=income`), `name`, `amount` (`Decimal(18,2)`,
value object `Money`), `currency`, `dayOfMonth` (1–31), `isActive`, timestamps. Relaciones
FK reales `Income.account`, `Income.category`, `Income.transactions`; `userId` es columna
sin `@relation` (convención del repo: el dominio financiero no toca el `User` que regenera
Better Auth — el "campo en usuario" se materializa vía `userId`, no como relación Prisma en
`User`).
- **Por qué:** la taxonomía de ingresos ya existe como `Category type=income`; una tabla
  `IncomeCategory` separada sería duplicación. La cuenta destino permite materializar el
  ingreso como `credit` en una cuenta real; se restringe a no-crédito porque un ingreso no
  entra a una tarjeta.

### D5. Generación manual idempotente vía `Transaction.incomeId`
`generateMonthlyIncome` crea una `Transaction` de ingreso (`direction=credit`, categoría
`type=income`) en la cuenta destino de la fuente, con su monto y fecha en `dayOfMonth` del
mes elegido. No hay riesgo de duplicar con los correos del banco: el banco solo reporta
gastos/cargos, transferencias y pagos internos (marcados `isInternal`), nunca ingresos. Idempotencia por `incomeId` + mes con
**check-then-insert dentro de una transacción DB** (no índice único parcial, porque el mes
es derivado de la fecha del movimiento).
- **Por qué:** simple y suficiente para uso manual de un solo usuario a la vez; el
  `incomeId` deja el gancho para recurrencia.
- **Alternativa descartada:** tabla `IncomeMonthlyEntry(incomeId, year, month)` con unique;
  más limpia pero es una tabla extra para algo que la verificación en el use-case ya cubre.

### D6. Ingresos **siembran** el `globalLimit`; no cambian cómo funciona
El `globalLimit` mantiene su comportamiento actual: editable a libertad y con carry-forward.
Los ingresos solo aportan un **valor inicial**: si el mes en curso no tiene `globalLimit`
definido (ni propio ni heredado), se materializa `Σ Income.amount` activos vía upsert de
`MonthlyBudget` (reusa `POST /api/budgets`). Si el mes **ya** tiene `globalLimit`, editar o
agregar ingresos NO lo sobrescribe: el sistema solo **sugiere** actualizarlo al nuevo total,
y la actualización requiere acción explícita del usuario.
- **Por qué:** el usuario pidió conservar la libertad de ajustar el presupuesto; la
  derivación es una semilla, no una atadura. Evita pisar ajustes manuales.
- **Alternativa descartada:** re-derivar en cada edición de ingreso (simple, pero pisa el
  ajuste manual y quita la libertad que el usuario quiere mantener).

### D7. Animaciones con CSS existente
Transición entre pasos con `fade-in` + `slide-in-from-right/left` (~300ms), respetando
`motion-reduce:`; háptica con `lib/haptics.ts`.
- **Por qué:** no introducir framer-motion para lo que `tailwindcss-animate` ya cubre.

## Risks / Trade-offs

- **Carrera en `generateMonthlyIncome` (check-then-insert)** → la operación corre dentro de
  una transacción DB; el riesgo real es bajo (un usuario tocando un botón). Marcado con
  comentario `ponytail:`; subir a constraint si aparece contención.
- **Refactor de `UncategorizedTriage`/`SnapshotForm` afecta su uso actual** → la prop
  `onDone` es opcional con el comportamiento actual por defecto; el dashboard no cambia.
- **`globalLimit` materializado puede desincronizarse si se editan ingresos sin recomputar**
  → toda escritura de ingresos recomputa y hace upsert; no hay otra vía de edición.
- **Onboarding "atascado" si un paso reutilizado falla** → cada paso mantiene su manejo de
  error actual; el shell permite reintentar/retroceder y salir sin dejar datos parciales
  (el import es atómico).

## Migration Plan

1. Migración Prisma: crear tabla `Income` (+ relaciones) y agregar columna `incomeId`
   nullable a `Transaction`. Aditiva, sin backfill.
2. Domain/application/infrastructure de ingresos + endpoints `/api/incomes`.
3. Refactor `onDone` en `UncategorizedTriage`/`SnapshotForm`.
4. `OnboardingFlow` + pantallas nuevas; gating en `sync-bancochile-button.tsx`.
5. Sección "Ingresos del mes" en el dashboard.
- **Rollback:** revertir el gating (el modal normal sigue funcionando) y, si hace falta,
  revertir la migración (columna/tabla nuevas, sin dependencias existentes).

## Open Questions

- Copys/tono de las pantallas de bienvenida y presupuesto listo (se resuelve en
  implementación con las skills de UI del proyecto; no bloquea el diseño).
