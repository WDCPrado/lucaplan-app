# Design: budget-cap-and-category-modal-ux

## Context

Hoy el modelo es: categorías **globales** del usuario (`Category`) + límite **por mes** con
carry-forward (`CategoryLimit`, fórmula `effectiveLimit` en
`arch/v1/application/finance-use-cases/budget-formulas.ts`). La vista de presupuestos
(`getBudgetView` → `BudgetViewDTO`) devuelve solo `categories`; el dashboard suma los límites en
el cliente (`totalBudget`) pero no existe nada que controle ese total. El modal de categoría
(`components/finance/category-modal.tsx`) mezcla identidad, descripción IA, 32 iconos, límite y un
`<input type="color">` nativo en una columna sin jerarquía.

Nota: la spec canónica `budget-planning` describe un modelo viejo (`budgets` por mes con
`budget_id` en categoría) que ya no corresponde al código (categorías globales + carry-forward).
El delta corrige los dos requirements contradictorios (MODIFIED/REMOVED) para que al archivar la
spec canónica quede coherente con el modelo real; una reconciliación más amplia sigue fuera de
alcance.

## Goals / Non-Goals

**Goals:**

- Persistir un límite global mensual del presupuesto (`monthly_budget.globalLimit`) por usuario+mes, con carry-forward.
- Derivar "restante por presupuestar" = límite global efectivo − Σ límites efectivos de categorías de gasto.
- Mostrar el restante arriba de Presupuestos y como ayuda al editar el límite de una categoría.
- Rediseñar el modal de categoría: vista previa, agrupación por intención, swatches de color.

**Non-Goals:**

- Sueldo / fuentes de ingreso del usuario (explícitamente pospuesto por el usuario).
- Reconciliación completa de la spec canónica `budget-planning` (el delta solo corrige los dos
  requirements que contradicen el modelo real).
- Bloquear la asignación cuando supera el límite global (se alerta, no se bloquea — coherente con
  `excedido` en gasto).
- Borrar el límite global (solo upsert; YAGNI hasta que haga falta).

## Decisions

### D1 — El presupuesto del mes se materializa como tabla `monthly_budget` (decisión del usuario)

Nueva entidad `MonthlyBudget { id, userId, year, month, globalLimit Decimal(18,2) }`,
`@@unique([userId, year, month])`, tabla `monthly_budget`. **ES** la tabla de presupuesto del mes
— nace mínima (solo el límite global) y es extensible después (fuentes de ingreso, nombre, etc.).

Las categorías **no** se asocian por FK al presupuesto: siguen globales con `CategoryLimit` por
mes y carry-forward, exactamente como hoy. Asociarlas al presupuesto de cada mes rompería el
carry-forward y obligaría a materializar filas por mes.

La moneda del presupuesto es **CLP por convención** (constante en el mapper, igual que
`setCategoryLimit` hoy); la tabla no lleva columna `currency` hasta que exista presupuesto
multi-moneda.

- Alternativa descartada: registro suelto `monthly_budget_cap` — mismo costo, pero no le da al
  usuario la entidad "presupuesto" que quiere ver crecer después.
- Alternativa descartada: Budget completo con FK desde categorías/límites — rompe el
  carry-forward actual y exige migrar datos, sin ganancia hoy.
- Alternativa descartada: categoría oculta especial — hack que contamina todas las fórmulas.

### D2 — Carry-forward igual que los límites de categoría (regla pedida por el usuario)

El límite global efectivo de (year, month) es el registro de ese mes o, si no existe, el del mes
anterior más reciente ("al cambiar de mes toma el del anterior", mismas reglas de ahora). Sin
ningún registro ⇒ **límite global no definido** (`null`), distinto de 0. Se implementa en
`budget-formulas.ts` compartiendo el helper de "último registro ≤ mes" con `effectiveLimit`
(extraer la búsqueda genérica; no duplicar el sort).

### D3 — Derivado, no persistido

`restantePorPresupuestar = límiteGlobalEfectivo − Σ effectiveLimit(categorías de gasto)`. Puede ser
negativo (sobre-asignado ⇒ la UI alerta con color destructive). Si el límite global es `null`, el restante
es `null` (no se muestra). Solo categorías `expense` cuentan (las `income` no tienen tope).
Coherente con la regla existente: uso/disponible/estado se calculan al vuelo.

### D4 — Port nuevo y pequeño: `MonthlyBudgetRepository`

`{ listByUser(userId): Promise<MonthlyBudget[]>; set(input): Promise<MonthlyBudget> }` en
`finance.domain.ts`, implementado en `finance.infrastructure.ts`, agregado a `financeDeps`.

- Alternativa descartada: colgarlo de `CategoryRepository` — el presupuesto no es una categoría;
  mismo costo de wiring, peor nombre.

### D5 — API aditiva

- `GET /api/budgets` extiende la respuesta: `{ categories, globalLimit: number|null,
  allocated: number, remainingToAllocate: number|null }` (backward compatible — solo agrega
  campos). `allocated` pasa al servidor (hoy el dashboard lo suma en el cliente; se elimina esa
  suma duplicada).
- `POST /api/budgets` con `{ year, month, globalLimit }` → upsert del presupuesto del mes por
  (userId, year, month). Validación **antes** de construir `Money` (porque `Money.of` redondea):
  `Number.isInteger(globalLimit) && globalLimit >= 0`, `month` 1–12, `year` en rango razonable;
  inválido ⇒ 422 sin redondeos silenciosos. Autenticación/ownership igual que el resto
  (`withUser`). No hace falta ruta nueva: el recurso es el mismo presupuesto.
- Alineación: `MonthlySummaryDTO.totalBudget` hoy suma los límites de TODAS las categorías; se
  alinea a solo-gasto (mismo criterio que `allocated`) para que el stat "Presup." y la cabecera
  nunca muestren totales distintos.

### D6 — Cabecera de Presupuestos (dashboard)

Arriba del panel de anillos: el **restante por presupuestar** como cifra principal, con
"asignado X de Y" como secundario y un botón de edición que abre un `ResponsiveModal` con money
input (`useMoneyInput`) para el límite global. Estados:

- Límite global definido y restante ≥ 0 → cifra normal.
- Restante < 0 → color destructive + texto "sobre-asignado".
- Límite global no definido → CTA "Definir presupuesto del mes" que abre el mismo modal.

El `Stat "Presup."` de la tarjeta de saldo no cambia.

### D7 — Rediseño del modal de categoría

Mismo `ResponsiveModal`; se reordena el contenido por intención:

1. **Vista previa en vivo** (cabecera): `ProgressRing` + `CategoryIcon` + nombre, reflejando
   icono/color/nombre mientras se editan — reutiliza los componentes reales del dashboard.
2. **Identidad**: Nombre + Tipo (segmented actual). El tipo solo editable al crear; al editar una
   categoría con movimientos, cambiar el lado income/expense rompería la correspondencia
   income↔credit / expense↔debit, así que se deshabilita en edición.
3. **Presupuesto** (solo `expense`): money input del límite + línea de ayuda con el restante por
   presupuestar **en vivo**: `restante = restanteDelMes + límiteOriginal − límiteEnPantalla`,
   donde `límiteOriginal` es el límite **efectivo** actual (el `CategoryDTO.limit`, que ya
   incluye carry-forward — no el registro crudo del mes). Si el límite global es `null`, la ayuda
   no aparece. Si queda negativo, la ayuda pasa a destructive (alerta, no bloquea).
4. **Apariencia**: grid de iconos actual + **swatches de color**: constante `CATEGORY_COLORS`
   (~12 hex curados, legibles en dark y light) junto a `CATEGORY_ICONS`. El color es dato
   persistido (hex), no token CSS — por eso es una paleta curada en código y no variables.
   Si la categoría trae un color fuera de la paleta (legacy), se muestra como swatch extra
   seleccionado para no perderlo. Desaparece el `<input type="color">` nativo.
5. **Descripción IA**: colapsable (shadcn `Collapsible`; instalar con
   `pnpm dlx shadcn@latest add collapsible` si falta), cerrada por defecto salvo que ya tenga
   texto.
6. **Guardar**: botón primario al final. Mismo flujo (POST categoría + POST límite), pero se
   corrige el manejo de error actual: si el segundo POST (límite) falla, el modal NO se cierra y
   se avisa con toast (sonner), en vez de cerrar como si todo hubiera funcionado.

Los datos del restante llegan por props desde el dashboard (ya tiene el budget view); el modal no
hace fetch propio.

## Risks / Trade-offs

- [Spec canónica desfasada del modelo real] → el delta es solo ADDED/MODIFIED puntual; la
  reconciliación completa de `budget-planning` queda fuera y anotada como pendiente.
- [Carry-forward del límite global sorprende en mes nuevo] → mismo comportamiento que los límites que el
  usuario ya conoce; la cabecera siempre muestra el mes activo.
- [Modal más alto con la vista previa] → la descripción colapsada compensa; en móvil el drawer
  full-height ya soporta scroll.
- [Cambiar `BudgetViewDTO` toca a los consumidores] → es aditivo; el único consumidor es el
  dashboard (server component), se actualiza en el mismo cambio.
- [Script `--db` apuntando a producción por error] → el script solo corre `migrate deploy`
  (aditivo, no destructivo) y pide confirmación mostrando el host de la base antes de aplicar.
- [`null` vs 0 es irreversible en la práctica] → una vez definido un límite global, el
  carry-forward hace que siempre haya uno (solo se puede cambiar, no "quitar"; 0 significa
  presupuesto cero, no "sin límite"). Aceptado como límite conocido (YAGNI un delete); el copy
  del modal lo deja claro.

## Migration Plan

1. `prisma migrate dev` local con la tabla nueva (aditiva; sin backfill — el límite global
   empieza sin definir).
2. **Script `scripts/migrate-db.mjs --db <DATABASE_URL>`** (patrón de `setup-db.mjs`): aplica
   `prisma migrate deploy` contra la base pasada por parámetro, para que el usuario elija cuándo
   migrar cada base (local / producción) desde consola. No destructivo (solo `deploy`, nunca
   `reset`). Mecánica: el datasource no define `url` en el schema, así que la URL se inyecta por
   entorno — `execFileSync("pnpm", ["prisma", "migrate", "deploy"], { env: { ...process.env,
   DATABASE_URL: dbArg } })`; nunca interpolar la URL en un string de shell.
3. Deploy normal. Rollback: revertir código; la tabla extra no rompe nada si queda.

## Open Questions

- Valores exactos de `CATEGORY_COLORS`: se fijan en implementación contrastando en dark/light
  (~1440px y ~375px según el flujo de verificación del proyecto). No bloquea.
