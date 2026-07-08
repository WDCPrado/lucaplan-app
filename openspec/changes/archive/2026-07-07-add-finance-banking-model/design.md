## Context

El backend usa clean architecture versionada (`arch/v1/domain|application|infrastructure`),
Prisma 7 sobre Postgres (cliente en `arch/v1/infrastructure/database/prisma/generated`), Better
Auth. `User.id` es `String` (cuid), no UUID. Regla de dependencias:
`presentation → application → domain`, `infrastructure → domain`; domain no importa de nadie.
Imports cross-capa dentro de `arch/` son relativos con `.ts` (para `node --test`).

Este MVP es deliberadamente simple: **5 entidades**, sin análisis de deuda ni estados mensuales
persistidos. La caja activa y el uso por categoría son **fórmulas**, no tablas.

## Goals / Non-Goals

**Goals:**
- Esquema Prisma de 5 tablas: `banks`, `accounts`, `budgets`, `categories`, `transactions`.
- Dominio finance: entidades, enums (`account_type`, `direction`), `Money`, ports.
- Funciones puras: caja activa (Σ saldo positivo de cuentas `checking`), uso/disponible por
  categoría de un presupuesto.
- Tests `node --test` con datos de Banco de Chile. Seed mínimo.

**Non-Goals:**
- Parsers PDF, adapters Postgres reales, categorización con IA, tipo de cambio.
- Historial de saldos (snapshots), cupos/límites de crédito como tabla, productos como capa.
- Análisis de deuda / modo operativo / risk_level / estados mensuales persistidos.
- API y UI.

## Decisions

- **Presupuesto = grupo de categorías por mes.** `budgets(user_id, name, year, month)` agrupa
  `categories(budget_id, name, limit_amount)`. Las categorías son **hijas del presupuesto** (no
  globales): así el presupuesto es por mes, no global. Borrar el presupuesto cascada sus
  categorías. Alternativa (categorías globales + tabla de límite por mes): más tablas y es el
  patrón "presupuesto global" que el usuario quiere evitar → descartada.

- **Banco propiedad del usuario, sin catálogo compartido ni join.** `banks(user_id, name)`. No
  hay `user_banks`: el usuario "tiene" un banco por poseer el registro. Cuenta → banco → usuario.
  Simplifica; el catálogo compartido de instituciones se puede agregar después.

- **Sin capa de productos ni de límites/snapshots.** `accounts` lleva `account_type`, `currency`
  y `balance` inline. Una TC con dos monedas son dos cuentas. El historial de saldos y los cupos
  se agregan cuando exista el import real. Esto responde al feedback de "muy específico".

- **Caja activa y uso por categoría = funciones puras, no entidades.** `computeActiveCash(accounts)`
  = Σ `balance` de cuentas `checking` con saldo > 0. `computeCategoryUsage(category, transactions)`
  = Σ gastos (`debit`) de esa categoría en el mes; disponible = `limit_amount − usado`. Se testean
  con fakes en memoria (sin adapters reales).

- **Sobregiro: saldo negativo = deuda, no caja.** `accounts` lleva `overdraft_limit`
  (`@db.Decimal`, default 0) y permite `balance` negativo en `checking`. La caja activa ignora los
  negativos (aporta 0). El sobregiro usado = `|balance|` cuando `balance < 0`; el sobregiro
  disponible = `overdraft_limit − usado` es capacidad de deuda, **no** caja. `computeOverdraft(account)`
  devuelve usado/disponible como derivados, no se persisten.

- **Caja activa ≥ 0 + deuda + posición neta, en vez de una caja que se hace negativa.** La caja
  responde "cuánto puedo gastar ahora" (recurso, nunca < 0); netear el negativo dentro de la caja
  mezcla recurso con obligación y esconde ambas verdades (dinero disponible en una cuenta y deuda en
  otra no se compensan para el usuario: la deuda genera interés y hay que pagarla). Se separan tres
  derivados: `caja activa` (≥0), `deuda de sobregiro` (Σ negativos), y `posición neta` =
  `caja − deuda` (aquí sí aparece el número negativo, como cifra de fondo). Alternativa (caja neta
  única, puede ser negativa): más simple pero pierde la distinción caja/deuda que es la tesis del
  dominio → descartada.

- **Estado de categoría por umbrales.** `categoryStatus(usado, limite)` → `bueno` (≤50%),
  `moderado` (>50% y <100%), `completado` (=100%), `excedido` (>100%). Superar el límite se permite
  (no bloquea el movimiento), solo cambia el estado. Función pura, testeable.

- **`Money` (monto decimal + moneda), no float.** DB usa `@db.Decimal(18,2)`. En dominio, montos
  como decimal string + `currency_code`; `Money` prohíbe mezclar monedas. Evita redondeos y mezcla
  CLP/USD.

- **Ids UUID en tablas nuevas, FK a usuario `String`.** `@default(uuid())` propio; `userId String`
  → `User.id`. No se toca Better Auth.

## Risks / Trade-offs

- **Categoría atada a un mes** → "Supermercado" de enero y de febrero son filas distintas. Es
  intencional (presupuesto por mes). Copiar el presupuesto del mes anterior es una feature futura,
  no del MVP.
- **Sin snapshots** → el `balance` de la cuenta es el actual; no hay historia. Aceptado para MVP.
- **Migración Postgres** → requiere `DATABASE_URL`; dominio+funciones+tests corren sin DB.
- **Moneda/redondeo** → `Money` con decimal string y prohibición de mezcla.
- **Moneda del movimiento vs. de la cuenta (deuda)** → el requisito exige que
  `transaction.currency` coincida con `financial_account.currency`, pero el MVP no lo fuerza: no
  hay ruta de escritura todavía (sin adapters/use-case de creación). **Pendiente:** validarlo en el
  use-case de creación de movimiento cuando llegue la capa de escritura (parser/import); opcional un
  CHECK o trigger en DB. Hasta entonces, la invariante depende de quien inserte los datos (seed).

## Migration Plan

1. Agregar los 5 modelos a `prisma/schema.prisma` (`@@map` snake_case, índices); `pnpm prisma
   migrate dev` (o `pnpm prisma generate` sin DB).
2. `arch/v1/domain/finance/`: entidades, enums, `Money`, ports.
3. `arch/v1/application/finance-use-cases/`: `computeActiveCash`, `computeCategoryUsage` (+ tipo
   presupuesto con categorías y sus derivados).
4. Tests `node --test` con fakes y datos de Banco de Chile.
5. Seed mínimo (un banco, cuentas, un presupuesto "Enero 2026" con categorías base).
Rollback: revertir migración y borrar carpetas nuevas; no afecta auth.

## Open Questions

- Categorización de movimientos con IA: enfoque y punto de integración (fase posterior).
- ¿Reglas de traspaso del presupuesto entre meses (copiar/plantilla)? Fuera del MVP.
