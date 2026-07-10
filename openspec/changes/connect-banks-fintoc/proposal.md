## Why

Hoy los bancos, las cuentas y los movimientos se cargan **a mano**: es tedioso, se equivoca y
queda desactualizado. Fintoc agrega la banca chilena (bancos, cuentas y movimientos reales) tras
una autenticación segura del usuario. Conectando un banco con Fintoc, LucaPlan pasa de ser un
registro manual a un tracker con **datos reales que se actualizan solos**. Lo manual se reserva
para lo que el usuario sí quiere llevar a pulso: sus **tarjetas**.

## What Changes

- **Conectar banco (Fintoc)** — acción nueva que abre el widget de Fintoc (`product: 'movements'`).
  Al autenticarse, el backend intercambia el token por un **Link** y **sincroniza**: la institución
  entra como `Bank`, sus cuentas como `FinancialAccount` y sus movimientos como `Transaction`
  (sin categoría; la categorización con IA se hará más adelante).
- **Cuentas conectadas = espejo de solo lectura del proveedor.** Su `balance` y sus movimientos
  vienen de Fintoc; la importación de movimientos es **idempotente** (no se duplican ni recalculan
  el saldo). Las cuentas manuales conservan el comportamiento actual (saldo derivado de sus
  movimientos).
- **Procedencia en el dominio.** `Bank`, `FinancialAccount` y `Transaction` ganan un origen
  (`manual` | `fintoc`) y los ids externos de Fintoc para sincronizar sin duplicar.
- **BREAKING (UX): "Nueva cuenta" → "Nueva tarjeta".** El alta manual se **acota a los tipos con
  tarjeta** (débito = corriente, crédito). Las cuentas bancarias completas ahora llegan por Fintoc,
  no a mano.
- **Actualización en tiempo real (webhook) + refresco manual.** Fintoc notifica por **webhook** los
  movimientos nuevos y la app re-sincroniza al instante (sin que el usuario haga nada); además puede
  **refrescar** a mano como respaldo. El webhook valida la **firma** de cada petición.
- **Puerto + adapter (clean arch).** Nuevo port `BankAggregationProvider` en `domain`; su
  implementación Fintoc (REST) vive en `infrastructure`. Nuevas rutas en `app/api` para crear el
  widget token, procesar la conexión/exchange, refrescar y recibir el webhook.
- **Config/secretos.** Env nuevas: `FINTOC_SECRET_KEY` (server-only), `NEXT_PUBLIC_FINTOC_PUBLIC_KEY`
  (widget) y `FINTOC_WEBHOOK_SECRET` (firma del webhook). En desarrollo se usan **test keys** (data
  simulada, gratis); el usuario provee las variables. La `sk_*` nunca llega al cliente.

## Capabilities

### New Capabilities
- `bank-connection`: Conectar un banco vía el widget de Fintoc, intercambiar el token por un Link,
  y sincronizar (idempotente) institución → banco, cuentas y movimientos, con actualización por
  webhook (tiempo real) y refresco manual. Puerto de agregación en el dominio y adapter Fintoc en
  infraestructura; secretos y frontera cliente/servidor.

### Modified Capabilities
- `finance-model`: `Bank`/`FinancialAccount`/`Transaction` incorporan **origen** (`manual` |
  `fintoc`) e ids externos; las cuentas conectadas toman `balance` y movimientos del proveedor y la
  importación es idempotente; el alta **manual** queda acotada a los **tipos con tarjeta**.
- `account-card`: el preview y el alta manual dejan de ser "crear cuenta" para ser **"crear
  tarjeta"** (solo tipos con tarjeta: débito/crédito); las cuentas conectadas se muestran con
  distintivo de **conectado** y su origen.

## Impact

- **DB**: migración Prisma — `provider`/ids Fintoc en `bank`, `financial_account`, `transaction`;
  `@@unique` del id de movimiento por cuenta para idempotencia; `lastSyncedAt`.
- **Dominio/aplicación**: nuevo port `BankAggregationProvider`, entidad/valor de conexión, y
  use-cases de conectar/sincronizar/refrescar (import de movimientos **sin** efecto de saldo).
- **Infraestructura**: adapter Fintoc (crear widget token, exchange, listar cuentas/movimientos),
  repos extendidos (upsert por id externo), verificación de firma del webhook.
- **Presentación/UI**: script/SDK del widget, flujo "Conectar banco", distintivo de cuenta
  conectada + refrescar, y rename "Nueva cuenta" → "Nueva tarjeta". Rutas `app/api/fintoc/*`.
- **Seguridad**: `sk_*` solo en servidor (nunca al cliente); `pk_*` al widget; validar la firma del
  webhook. Se usan **test keys** en desarrollo.
- **Dependencias**: `@fintoc/fintoc-js` (widget) y opcional `fintoc` (SDK Node) — o `fetch` directo
  contra `https://api.fintoc.com`.
