## 1. Config y secretos

- [x] 1.1 Definir env: `FINTOC_SECRET_KEY` (server-only), `NEXT_PUBLIC_FINTOC_PUBLIC_KEY` y `FINTOC_WEBHOOK_SECRET` (test keys en dev; el usuario provee las variables); renombrar el `secret=` suelto de `.env` — hecho (usuario puso test keys; `.env.example` documentado)
- [x] 1.2 Helper `lib/fintoc/config.ts` (server-only) que lea las env y falle claro si falta la secret; nunca exponer `sk_*` al cliente
- [x] 1.3 Agregar `@fintoc/fintoc-js` (widget de cliente) a dependencias

## 2. Base de datos (migración aditiva)

- [x] 2.1 `schema.prisma`: `bank` → `provider` (default `manual`), `externalLinkId`, `linkToken`, `lastSyncedAt`
- [x] 2.2 `schema.prisma`: `financial_account` → `provider` (default `manual`), `externalId`, `lastSyncedAt`
- [x] 2.3 `schema.prisma`: `transaction` → `externalId`, `status` (`confirmed|pending|reversed|duplicated`, default `confirmed`), `pending` (bool) + `@@unique([accountId, externalId])`
- [x] 2.4 Generar y aplicar la migración (`20260709140000_connect_banks_fintoc`); filas existentes quedan `provider = manual`

## 3. Dominio

- [x] 3.1 `finance.domain.ts`: `provider` (`manual|fintoc`) e ids externos en `Bank`/`Account`/`Transaction`; `status`/`pending` del movimiento en `Transaction`; inputs de sync; manual = `confirmed`
- [x] 3.2 Nuevo port `BankAggregationProvider` (`bank-aggregation.port.ts`) con `listAccounts`/`listMovements` y tipos `ProviderAccount`/`ProviderMovement` — sin `createWidgetToken`/`exchange`: el widget de agregación abre con la public key y el backend valida el `link_token` (ver 5.1)
- [x] 3.3 Extender ports de repos: upsert de banco/cuenta por id externo y `importMovements` (import idempotente **sin** ajustar saldo) + saldo del proveedor
- [x] 3.4 Errores de dominio: `ConnectedAccountReadOnlyError`, `WebhookSignatureError`, `BankConnectionError`

## 4. Infraestructura

- [x] 4.1 Adapter Fintoc (`infrastructure/http/fintoc/fintoc.provider.ts`) sobre `fetch` a `https://api.fintoc.com/v1`: listar cuentas y movimientos (auth por header, `link_token` query, paginación por header `Link`)
- [x] 4.2 Mapeos (`fintoc-map.ts`): tipo de cuenta Fintoc → `AccountType`; `amount`/moneda → `Money`; signo → `direction`; `status`/`pending` (con test)
- [x] 4.3 Repos Prisma: `upsertConnected` (bank/account), `importMovements` como **upsert** por `(accountId, externalId)` que actualiza contenido y `status` **preservando `categoryId`**, sin efecto de saldo; saldo del proveedor + `lastSyncedAt`
- [x] 4.4 Verificación de firma del webhook de Fintoc (`webhook.ts`, HMAC-SHA256, fail-closed)

## 5. Aplicación (use-cases)

- [x] 5.1 Config del widget: el widget de agregación **exige `webhookUrl`** y NO entrega el `link_token` en `onSuccess`; `widget-config` arma la URL con un `uid` firmado (HMAC) para asociar la entrega al usuario
- [x] 5.2 `connect-bank-use-case`: recibe el Link del widget → primera sincronización
- [x] 5.3 `sync-link-use-case`: institución → banco, cuentas y movimientos (leer con `confirmed_only=false`, histórico en la 1ª sync), idempotente; saldo del proveedor; movimientos sin categoría; estados actualizados cada sync
- [x] 5.4 `refresh-connection-use-case` (refresco manual) reutilizando `sync-link`
- [x] 5.5 Guardas de ownership y solo-lectura: en cuentas `fintoc`, `createTransaction` lanza `ConnectedAccountReadOnlyError` (además la UI no las ofrece)
- [x] 5.6 `budget-formulas`/`finance-read` cuentan **solo movimientos `confirmed`** (excluyen pending/reversed/duplicated); las listas ocultan reversed/duplicated

## 6. Presentación (rutas API)

- [x] 6.1 `POST /api/fintoc/widget-config` → `webhookUrl` con `uid` firmado (la public key la tiene el cliente)
- [x] 6.2 Conexión: la hace el **webhook** (recibe el `link_token` con el `uid` firmado → primera sync). La ruta `/api/fintoc/connect` queda sin uso
- [x] 6.3 `POST /api/fintoc/refresh` → refresco manual de un banco conectado
- [x] 6.4 `POST /api/fintoc/webhook` → camino A (conexión: `uid` firmado + `link_token` → sync del usuario) y camino B (actualización: firma de Fintoc + banco por link id); idempotente
- [x] 6.5 Mapear errores de dominio a HTTP en `finance-http` (401 webhook, 422 read-only/conexión, 404 ownership)

## 7. UI

- [x] 7.1 `connect-bank-button.tsx`: pide `widget-config`, abre el widget con `webhookUrl` (`product:'movements'`), y tras `onSuccess` **sondea** `/api/accounts` hasta ver el banco y refresca
- [x] 7.2 CTA "Conectar banco" en la sección de cuentas del dashboard (visible solo si hay public key)
- [x] 7.3 `AccountCard`: distintivo "Conectado" + acción refrescar; cuenta `fintoc` de solo lectura
- [x] 7.4 Rename "Nueva cuenta" → "Nueva tarjeta": `AccountModal`/tile acotado a tipos con tarjeta (débito/crédito), últimos 4 dígitos siempre obligatorios
- [x] 7.5 `AddTransactionSheet` solo ofrece cuentas manuales (las `fintoc` no admiten movimientos a mano)

## 8. Verificación

- [x] 8.1 Tests de dominio/mapeo: mapeo tipo/monto CLP-USD/direction/status (`fintoc-map.test.ts`)
- [x] 8.2 Flujo de sync con fakes: primera sync (saldo del proveedor) + re-sync idempotente que preserva categoría (`sync-link.test.ts`)
- [x] 8.3 `pnpm typecheck` (OK) + `pnpm lint` (0 errores) + 22 tests `node --test` verdes
- [~] 8.4 Verificación de arranque: app sirve con los cambios (`/login` 200, `/api/accounts` 401, rutas `/api/fintoc/*` compilan → 401). El visual del dashboard logueado (CTA, "Nueva tarjeta", badge) queda para el usuario, que lo ejercita con sus test keys + túnel (requiere sesión y el widget real de Fintoc)
