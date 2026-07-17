# OpenSpec — Luca Plan

**Antes de proponer o aplicar un cambio, lee el [README del repo](../README.md)** (contexto
canónico) y [docs/development.md](../docs/development.md) (el flujo `opsx:propose → apply →
verify → sync → archive`). Aquí se documenta **solo el delta** de cada cambio: lo que ya está en
el README o en `docs/` no se repite.

## Estructura

- **`specs/<capacidad>/spec.md`** — contrato canónico vigente de cada capacidad. Es lo que la app
  debe cumplir hoy.
- **`changes/<change-id>/`** — cambio en curso: `proposal.md`, `design.md`, `tasks.md` y specs
  delta. Al archivar, el delta se promueve a `specs/`.
- **`changes/archive/`** — historial. Se conserva **intacto** y puede describir integraciones ya
  retiradas: es historia, no contrato. Nunca lo edites para reflejar el presente.

## Capacidades canónicas

| Capacidad               | De qué trata                                                        |
| ----------------------- | -------------------------------------------------------------------- |
| `finance-model`         | Modelo de dominio: bancos, cuentas, movimientos, monedas, sobregiro. |
| `finance-api`           | Contratos HTTP de finanzas.                                          |
| `finance-ui`            | Superficies de la app de finanzas.                                   |
| `budget-planning`       | Presupuesto mensual, límites por categoría y caja activa.            |
| `account-card`          | Representación de una cuenta como tarjeta bancaria.                  |
| `bank-connection`       | Conexión de bancos vía proveedor de agregación.                      |
| `bank-email-connection` | Conexión por correo (Outlook / Microsoft Graph, Banco de Chile).     |
| `uncategorized-triage`  | Clasificación en lote de movimientos sin categoría.                  |
| `app-shell`             | Shell de navegación (sidebar, drawer, responsividad).                |
| `design-system`         | Tokens y primitivos visuales.                                        |

Si una spec canónica contradice al código o al README, corrige primero la fuente canónica.
