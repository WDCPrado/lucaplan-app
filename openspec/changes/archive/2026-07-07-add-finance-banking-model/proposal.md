## Why

LucaPlan tiene auth y usuarios, pero el dominio financiero —el "para qué" de la app— está
vacío. La base es simple: un usuario tiene **bancos con cuentas** (donde vive el dinero y los
movimientos) y **presupuestos por mes** (donde planifica). El presupuesto es el corazón: un
**grupo de categorías con límite, por mes** — no un presupuesto global estático (que es donde
fallan muchas apps). La "caja activa" no es una entidad: es una fórmula sobre las cuentas.

## What Changes

- Nuevo **modelo de datos Prisma** de 5 entidades: `banks`, `accounts`, `budgets`, `categories`,
  `transactions`. FKs a usuario como `String` (el `User.id` existente es cuid de Better Auth,
  **no** UUID). Migración generada.
- **Banco → cuentas:** un usuario tiene N bancos; cada banco N cuentas; cada cuenta con
  `account_type`, moneda y saldo. Los movimientos (`transactions`) cuelgan de una cuenta.
- **Presupuesto por mes:** `budgets` (nombre, año, mes) agrupa `categories`; cada categoría tiene
  su límite. El presupuesto controla sus categorías. Un usuario puede tener N presupuestos.
- **Derivados por fórmula, no por tabla:** caja activa = Σ saldo de cuentas corrientes; usado por
  categoría = Σ transacciones de esa categoría en el mes; disponible = límite − usado.
- Nuevo **dominio finance** (`arch/v1/domain/finance/`): entidades, enums, value object `Money`
  (monto + moneda; prohíbe mezclar CLP/USD), y ports de repositorio (sin implementar).
- **Funciones puras** (application): caja activa y uso/disponible por categoría de un presupuesto.
- **Tests** (`node --test`) con datos del caso Banco de Chile. **Seed** mínimo.

## Capabilities

### New Capabilities

- `finance-model`: modelo de datos — bancos y cuentas (con tipo, moneda, saldo) y movimientos
  categorizables, más las invariantes de moneda y tipo de cuenta.
- `budget-planning`: presupuesto mensual como grupo de categorías con límite; cálculo derivado de
  usado/disponible por categoría y de la caja activa (fórmulas, sin persistir).

### Modified Capabilities

<!-- Ninguna. -->

## Impact

- **Código nuevo:** `prisma/schema.prisma` (5 modelos + migración), `arch/v1/domain/finance/`,
  `arch/v1/application/finance-use-cases/`, seed. Sin tocar auth/authorization/user.
- **Base de datos:** 5 tablas nuevas; ninguna alteración a `user`/`session`/`account`.
- **Fuera de alcance (fases posteriores):** parsers de cartola PDF, adapters Postgres reales,
  categorización con IA de movimientos, tipo de cambio, historial de saldos (snapshots), límites
  de crédito/cupos como tabla, análisis de deuda/modo operativo, API y UI.
- **Sin dependencias npm nuevas.**
