## Context

LucaPlan modela `Bank` → `FinancialAccount` → `Transaction` (clean arch: dominio puro + ports,
Prisma en infraestructura, use-cases en aplicación, Route Handlers en `app/api`). Hoy todo se crea
a mano y el saldo de cada cuenta se deriva de sus movimientos (ver
`transactionRepository.create`, que ajusta `balance` atómicamente).

Fintoc (agregación de datos, Chile) expone la banca del usuario tras un login seguro dentro de su
**widget** (`product: 'movements'`): el backend crea un token con la **secret key** (`sk_*`), el
cliente abre el widget con la **public key** (`pk_*`), y al conectar se obtiene un **Link** desde
el que se leen **cuentas** y **movimientos**; Fintoc actualiza periódicamente y notifica por
**webhook**. La secret key ya está en `.env` (y es `sk_live_…`).

## Goals / Non-Goals

**Goals:**
- Conectar un banco por el widget de Fintoc y **sincronizar** institución → banco, cuentas y
  movimientos, de forma **idempotente**.
- Reutilizar el modelo existente con un discriminador de **origen** (`manual` | `fintoc`) en vez de
  tablas espejo; renderizar cuentas conectadas y manuales por el mismo camino.
- Mantener clean arch: un **port de agregación** en dominio, su **adapter Fintoc** en
  infraestructura; secretos solo en servidor.
- Rebautizar el alta manual "Nueva cuenta" → **"Nueva tarjeta"** (solo tipos con tarjeta).

**Non-Goals:**
- Pagos/transferencias (Fintoc *Transfers*): fuera de alcance.
- **Categorización de movimientos** (manual o con IA): fuera de alcance. Los importados quedan **sin
  categoría** por ahora; la categorización con IA es un paso posterior.
- Multi-institución en un mismo Link, multi-país, o histórico > al que entregue el plan.
- Conversión de monedas (se respeta la invariante `Money` existente).

## Decisions

### 1. Port en dominio + adapter Fintoc en infraestructura
`domain/finance/bank-aggregation.port.ts` define `BankAggregationProvider`:
`createWidgetToken(userId)`, `exchange(token) → { linkId, institution }`,
`fetchAccounts(linkId)`, `fetchMovements(linkId, accountId, since?)`. El dominio no conoce HTTP.
La implementación (`infrastructure/http/fintoc/…`) llama a `https://api.fintoc.com`.
- *Alternativa:* llamar a Fintoc desde los use-cases/rutas → rechazada: acopla dominio a un tercero
  y rompe la regla de dependencias.

### 2. Extender el modelo con `provider`, no tablas espejo
Migración aditiva (todo nullable / con default `manual`, sin romper filas actuales):
- `bank`: `provider` (`manual|fintoc`, default `manual`), `externalLinkId` (Link de Fintoc),
  `lastSyncedAt`.
- `financial_account`: `provider`, `externalId` (cuenta de Fintoc), `lastSyncedAt`.
- `transaction`: `externalId` (movimiento de Fintoc) + `@@unique([accountId, externalId])`.

Un **Link ≈ una institución ≈ un `Bank`** del usuario, así que el id del Link vive en `bank` y no
hace falta tabla `bank_connection`.
- *Alternativa:* tablas separadas para lo conectado → rechazada: duplica el modelo y el render.
- *ponytail:* Link en `bank`. Si un Link llegara a abarcar varias instituciones, se sube a una
  tabla `bank_connection` (userId, externalLinkId, status) — ceiling conocido.

### 3. Saldo e importación idempotente
- **Cuenta conectada:** `balance` = el que reporta Fintoc; se **sobrescribe** en cada sync. Sus
  movimientos se **upsertan** por `(accountId, externalId)` con un método nuevo del repo
  (`importMovements`) que **NO** ajusta el saldo (a diferencia de `create`, que sí lo hace para las
  manuales). Evita doble conteo.
- **Cuenta manual:** sin cambios (saldo derivado de sus movimientos).

### 4. Acceso a Fintoc: `fetch` en servidor, `@fintoc/fintoc-js` en cliente
El widget requiere el SDK JS de cliente (`@fintoc/fintoc-js` o `<script src="https://js.fintoc.com/v1/">`).
Las ~4 llamadas de servidor (crear token, leer link/cuentas/movimientos) se hacen con `fetch`
nativo — sin sumar el SDK Node.
- *Alternativa:* dependencia `fintoc` (SDK Node) → se evita por YAGNI para tan pocos endpoints.

### 5. Flujo de conexión (frontera cliente/servidor) — vía `webhookUrl`
El widget de agregación (`product:'movements'`) **exige** un `webhookUrl` y NO entrega el
`link_token` en `onSuccess` (solo el link id); Fintoc lo entrega al `webhookUrl`. Por eso:
1. Cliente pide `POST /api/fintoc/widget-config` → servidor responde `{ webhookUrl }` con un **`uid`
   firmado** (HMAC del userId) para asociar la entrega al usuario.
2. Cliente abre `Fintoc.create({ product:'movements', publicKey, webhookUrl, onSuccess, onExit })`.
3. Fintoc entrega el `link_token` a `POST /api/fintoc/webhook?uid=...`; el webhook verifica el `uid`,
   crea/actualiza el banco y hace la **primera sync** (server-side, autoritativo).
4. `onSuccess` (solo link id) → el cliente **sondea** `/api/accounts` hasta ver el banco y refresca.
5. El **mismo webhook** recibe las actualizaciones (mismo `webhookUrl` con `uid`, o webhook del
   dashboard con firma de Fintoc → banco por link id) → **tiempo real**. `POST /api/fintoc/refresh`
   fuerza a mano.
- *Alternativa:* flujo `link_intent` + `exchange_token` (widgetToken) — descartado: el endpoint de
  exchange no está documentado con precisión y el `webhookUrl` es el patrón oficial del quickstart.
- *ponytail:* el `uid` firmado autentica la entrega de conexión; para prod, además exigir la firma
  del webhook de Fintoc (`FINTOC_WEBHOOK_SECRET`) — ceiling conocido.

### 6. Mapeo de tipos y montos
- **Tipo de cuenta:** tabla de mapeo Fintoc → nuestro `AccountType` (p.ej. cuenta corriente →
  `checking`, tarjeta de crédito → `credit_card`) para que las fórmulas de caja/deuda sigan válidas.
- **Monto:** el monto de Fintoc (`amount` entero en la mínima unidad de la moneda) se mapea a
  `Money` en la unidad correcta por moneda (CLP sin decimales); el signo/tipo del movimiento →
  `direction` (`credit`/`debit`). Va con test unitario.

### 7. Movimientos mutables: upsert por id + estado, cálculos sobre `confirmed`
Los movimientos de Fintoc **no son inmutables**: `id` estable (`mov_…`), un `status`
(`confirmed` | `pending` | `reversed` | `duplicated`, + flag `pending`) y campos que el banco puede
corregir hasta ~5 días después. Estrategia:
- **Upsert por `(accountId, externalId)`:** una actualización llega con el mismo id → se sobrescriben
  monto/fechas/descripción/estado, **preservando `categoryId`** (metadata de LucaPlan; hoy queda
  nula, pero no se pisa cuando llegue la categorización con IA). Nunca duplica.
- **Guardar `status`/`pending`;** los cálculos (caja, uso de categoría, presupuesto) cuentan **solo
  `confirmed`**. Un `reversed`/`duplicated` deja de contar solo por cambiar de estado.
- **Sincronizar con `confirmed_only=false`** para capturar el ciclo completo (pending→confirmed) y
  detectar reversos/duplicados.
- **Saldo autoritativo del proveedor** (no derivado): aunque un movimiento cambie o se revierta, el
  saldo sigue cuadrado con el banco — red de seguridad.
- *ponytail:* Fintoc marca `reversed`/`duplicated` en vez de **borrar**, así que no hace falta
  reconciliar por ausencia. Si algún día un movimiento pudiera desaparecer del listado, se añade una
  reconciliación por ventana (soft-remove de los ausentes) — ceiling conocido.

## Risks / Trade-offs

- **Nunca exponer `sk_*` al cliente.** → solo `pk_*` como `NEXT_PUBLIC_FINTOC_PUBLIC_KEY`; en dev se
  usan **test keys** (data simulada, gratis).
- **El webhook necesita URL pública en dev.** → resuelto: el usuario ya tiene un túnel de URL para
  recibir el POST de Fintoc en local; la firma se valida siempre.
- **Desalineación de unidad/moneda del monto → saldos incorrectos.** → mapeo explícito + test con un
  caso CLP y uno USD.
- **Tipos de cuenta de Fintoc no calzan 1:1 con los nuestros** (afecta `computeActiveCash` /
  `creditCardDebts`). → tabla de mapeo con fallback y test.
- **Reproceso de webhooks / orden de llegada.** → el dedupe por id externo hace la sync
  re-ejecutable sin efectos: seguro ante reintentos.
- **Cuenta conectada de solo lectura** limita al usuario a lo que trae el proveedor. → aceptado; lo
  manual queda para las tarjetas.

## Migration Plan

1. **DB:** migración Prisma aditiva (columnas nullable + default `manual` + índice único). Filas
   existentes quedan `manual` → sin romper nada.
2. **Env:** `FINTOC_SECRET_KEY`, `NEXT_PUBLIC_FINTOC_PUBLIC_KEY` y `FINTOC_WEBHOOK_SECRET` (test keys
   en dev; el usuario las provee). Renombrar el `secret=` suelto de `.env`.
3. **Rollout:** la CTA "Conectar banco" detrás de un flag/env; si falta config, no se muestra.
4. **Rollback:** columnas aditivas y nullables; ocultar la CTA revierte la feature sin tocar datos
   manuales.

## Open Questions

- Mapeo exacto **tipo de cuenta Fintoc → `AccountType`** (y si las tarjetas de crédito reportan el
  saldo como deuda negativa, para `creditCardDebts`) — se resuelve al implementar, leyendo la
  respuesta real del sandbox.
- **Histórico**: se importa lo que Fintoc entregue por institución/plan (no lo fijamos nosotros; en
  test es data simulada). El precio de agregación no es público (B2B, ventas); el modo test es
  gratis.
- **Categorización con IA** (paso posterior): cómo y cuándo clasificar los movimientos importados
  (en el import / bajo demanda) se define en su propio cambio.
