## Why

Hoy, la primera vez que un usuario conecta Outlook, cae directo al modal de sync sin
guía: ve movimientos sin categorizar y un presupuesto vacío, sin saber por dónde empezar.
No hay forma de declarar sus ingresos, así que el presupuesto (`globalLimit`) no tiene una
base real. Necesitamos un onboarding que, la primera vez, lo lleve de "correo conectado" a
"presupuesto armado" reutilizando lo que ya existe, y modelar los ingresos como entidad
propia para que el presupuesto se calcule solo.

## What Changes

- **Onboarding fullscreen la 1ª vez** que se conecta Outlook, disparado por el retorno del
  callback OAuth (`?outlook=setup` cuando aún no hay `bankId`). Máquina de pasos
  client-side (`OnboardingFlow`) que **envuelve** componentes existentes: escaneo de
  candidatos, `SnapshotForm`, overlay de progreso de import, y `UncategorizedTriage` +
  `CorrectionLearnStep` para la parte conversacional.
- **Paso conversacional acotado:** en el onboarding se hace triage solo de los ~6–8 grupos
  de comercio más frecuentes sin categoría; el resto queda para el triage normal del
  dashboard.
- **Nueva entidad `Income`** (fuente de ingreso mensual, creada a mano): relación
  `User 1—N Income`, cada una con categoría de ingreso (`Category` `type='income'`),
  nombre, monto, moneda, día de ingreso e `isActive`.
- **Generar ingreso del mes (manual):** botón que materializa el ingreso como una
  `Transaction` (`direction=income`), idempotente por `incomeId` + mes. `Transaction`
  gana columna `incomeId` (nullable) como gancho para la recurrencia automática futura.
- **Presupuesto sembrado por ingresos (sin cambiar cómo funciona):** el `globalLimit`
  sigue siendo editable a libertad y con carry-forward. Los ingresos solo lo **siembran**
  cuando el mes aún no tiene límite definido (suma de `Income.amount` activos vía el
  endpoint existente). Editar/agregar ingresos después no pisa el límite; solo sugiere
  actualizarlo con acción explícita del usuario.
- **Fuera de scope:** Gmail, recurrencia automática de ingresos, frecuencias distintas a
  mensual, deep-linking a pasos del onboarding.

## Capabilities

### New Capabilities
- `onboarding-flow`: flujo fullscreen de primera conexión que orquesta detección,
  confirmación de cuentas, import, categorización conversacional acotada, captura de
  ingresos y creación del presupuesto, reutilizando capabilities existentes.
- `incomes`: entidad de fuentes de ingreso mensuales creadas a mano, con categoría de
  ingreso asociada y generación manual del movimiento de ingreso del mes.

### Modified Capabilities
- `budget-planning`: `globalLimit` deja de ser solo un valor ingresado a mano y pasa a
  poder derivarse de la suma de ingresos activos del usuario.

## Impact

- **Datos/Prisma:** nuevo modelo `Income` (+ relaciones `User.incomes`,
  `Category.incomes`); columna `incomeId` nullable en `Transaction`. Nueva migración.
- **Clean architecture (`arch/v1/`):** `domain/finance/income.domain.ts`; use-cases de
  ingresos (`create/update/delete/list`, `generate-monthly-income`);
  `infrastructure/database/prisma/income.infrastructure.ts`.
- **API:** `app/api/incomes` (GET/POST), `app/api/incomes/[id]` (PATCH/DELETE),
  `app/api/incomes/[id]/generate` (POST). Reutiliza `POST /api/budgets`.
- **UI:** nueva carpeta `components/finance/onboarding/` (`OnboardingFlow` + pantallas de
  bienvenida, ingresos y presupuesto listo); pequeño refactor para que
  `UncategorizedTriage` y `SnapshotForm` acepten `onDone`/modo embebido; sección
  "Ingresos del mes" en el dashboard con botón "generar". Gating en
  `sync-bancochile-button.tsx` para montar el onboarding en la primera conexión.
- **Sin dependencias nuevas:** animaciones con CSS + `tailwindcss-animate` existentes.
