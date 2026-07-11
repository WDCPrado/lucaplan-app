## Why

La integración con Fintoc obliga a operar como agregador hosteado (secret key en servidor, webhook
público, widget) y a custodiar tokens de acceso financiero. Para un uso **estrictamente personal y
local** eso es innecesario y jurídicamente más expuesto. Se reemplaza por un **scraper local de
Banco de Chile** (perfil de navegador en disco, login directo del usuario, solo-lectura, leyendo las
APIs JSON internas del portal) con el tratamiento de datos íntegramente en la máquina del usuario.
Sin usuarios en producción todavía, es el momento de además **corregir el modelo interno**: hoy es
plano y no distingue cuenta / tarjeta / cupo ni trata el sobregiro como deuda.

Validado con spike guiado real: auth por cookies (sin CSRF/bearer), sesión que expira en minutos,
endpoints JSON estables, dedup por `id` en cuenta corriente y ausencia de id en tarjeta no facturada.

## What Changes

- **BREAKING**: se elimina Fintoc (widget, webhook, secret key, rutas `app/api/fintoc/*`, deps). La
  conexión pasa a **login local directo** en el portal de BCH con perfil persistente (Patchright).
- **BREAKING**: se elimina la **actualización por webhook**. La sincronización es **pull disparada
  por el usuario** desde una **server action local** que raspa en caliente justo tras el login (la
  sesión expira en minutos; sin cron ni sync desatendido; 2FA la resuelve el usuario en la ventana).
- **Contrato local nuevo** (no el port de Fintoc): un `LocalBankConnector` orientado a resultado
  (`syncConnection() → snapshot/deltas por fuente`), sin `linkToken`/`revokeLink`/`updatedSince`
  (semántica de Fintoc que no aplica a una sesión efímera). El port genérico multi-banco se extrae
  recién cuando exista un 2º banco con intersección real.
- **Modelo por entidades** (tu jerarquía, con un ajuste de correctitud):
  `Bank → Cuenta(FinancialAccount) → Tarjeta(Card) → Saldo(BalanceBucket)`, y las **transacciones
  cuelgan de la Cuenta** referenciando un bucket (no del bucket: un saldo/cupo es una **medición
  mutable** —usado/disponible/límite—, no el libro contable). Buckets:
  `cash | overdraft | credit_national | credit_international`, cada uno con
  `limit/used/available/currency/asOf`. Una cuenta corriente tiene 1 tarjeta débito con buckets
  `cash` + `overdraft`; una cuenta de crédito tiene 1+ tarjetas con buckets `credit_national` (CLP)
  y/o `credit_international` (USD).
- **Sobregiro como deuda**: el bucket `overdraft` es parte de la cuenta pero cuenta como **crédito
  que genera interés**; su `used` (de `montoUtilizadoLinea` **o** `saldoFinal` negativo — una sola
  fuente autoritativa, nunca ambas) es deuda y **no** es caja.
- **Estrategia de sync por fuente**:
  - Cuenta corriente (`getCartola`, paginado, movs con `id` estable): primera conexión trae **~3
    meses**; incremental usa una **ventana de reconciliación solapada** (~30–90 días) con **upsert
    por `id`** (no "parar al primer id conocido": movimientos tardíos/correcciones quedarían atrás).
  - Tarjeta no facturada (`movimientos-no-facturados`, **sin id**): **snapshot-replace atómico** por
    tarjeta (bajar y validar la foto nueva **antes** de borrar; si falla, conservar la previa;
    guardar `asOf`/conteo). **No** se arrastra categoría cuando la clave por contenido es ambigua
    (compras idénticas): mejor sin categoría que categoría equivocada.
  - No facturados = **proyección**: se muestran pero **no** cuentan en gasto/presupuesto ni se
    categorizan por ítem hasta facturarse (evita doble conteo). La conciliación facturado y cuotas
    quedan como iteración posterior explícita.
- **UI de tarjetas/cuentas**: mostrar **saldo débito** y **saldo sobregiro si aplica**, con **color
  cuando es negativo** (deuda). Las **tarjetas de crédito de una misma cuenta se muestran juntas**,
  con sus cupos nacional/internacional separados (CLP y USD nunca se suman).
- **Arquitectura adaptable + docs**: el conector de BCH es una implementación local aislada; se
  documenta el **procedimiento para incorporar otro banco** mediante el **flujo de login guiado**
  (el usuario abre e inicia sesión, el agente captura endpoints/payloads) usado para construir este.
- **Seguridad local**: el perfil persistente (cookies autenticadas) queda **fuera de git/backups**,
  con ruta configurable y acción explícita de **borrar perfil**; NO se almacena contraseña ni 2FA;
  "desconectar" borra los datos locales del banco. Ante CAPTCHA/bloqueo (401/403/429): **detenerse**,
  nunca evadir.
- **Deploy solo local**: se descarta Railway/serverless para esta funcionalidad.

## Capabilities

### New Capabilities
- `bank-adapter`: contrato y ciclo de vida de un **conector de banco local** (login headful + perfil
  persistente, solo-lectura, resultado por fuente, parada ante bloqueo), más el **procedimiento
  documentado** para incorporar un banco nuevo vía captura por login guiado.

### Modified Capabilities
- `bank-connection`: de widget+webhook (Fintoc) a **login local + sync pull** (scraper BCH). Se
  eliminan widget y webhook; se reescriben conexión, ciclo de sesión y estrategia por fuente (3 meses
  inicial, ventana solapada + upsert, snapshot atómico para no facturados); se conservan solo-lectura
  e idempotencia.
- `finance-model`: del modelo plano al **modelo por entidades** `Cuenta → Tarjeta → Saldo(bucket)`
  con transacciones colgando de la cuenta. Se agregan **Card**, **BalanceBucket** (con `ámbito`
  nacional/internacional y `asOf`) y el **sobregiro como bucket tratado como deuda**. Origen
  `bancochile`; los no facturados se persisten sin `externalId` (snapshot).
- `account-card`: las superficies muestran **saldo débito + saldo sobregiro** con **color en negativo
  (deuda)**, los **cupos nacional/internacional** por separado, y **agrupan las tarjetas de crédito
  de una misma cuenta**.

## Impact

- **Dominio**: nuevas entidades `Card`, `BalanceBucket`; `FinancialAccount` pasa a ser la cuenta/
  producto. Nuevo contrato `LocalBankConnector` (reemplaza el uso del port de Fintoc). Se elimina el
  concepto de `linkToken` persistente.
- **Aplicación**: `syncLink` → `syncLocalConnection` con estrategia por fuente (ventana solapada +
  upsert por id; snapshot-replace atómico). `fintoc-map.ts` → mapeo del conector BCH.
- **Infraestructura**: nuevo conector BCH (Patchright, perfil persistente, endpoints
  `cuentas/saldos`, `obtenerProductos`, `getCartola`, `tarjeta saldo/obtener-saldo`,
  `movimientos-no-facturados`). Se eliminan `http/fintoc/*` y `lib/fintoc/*`.
- **Presentación**: se eliminan rutas `app/api/fintoc/*`; server action local de login/sync con
  progreso. UI de conectar = login local + botón "Sincronizar".
- **Modelo/DB**: migración Prisma (Card, BalanceBucket, campos de sobregiro/ámbito/asOf, transacción
  → cuenta + bucket ref). Sin datos de usuarios que migrar.
- **UI**: rediseño de tarjetas (saldo débito + sobregiro con color, cupos NAC/INT, agrupación por
  cuenta).
- **Docs**: guía `docs/` del procedimiento para agregar un banco vía login guiado; los scripts de
  spike (`scripts/spike-bch-*.ts`, `dedup-check.mjs`) quedan como referencia del método.
- **Dependencias**: se agrega `patchright` + `tsx`; se quita el SDK/config de Fintoc y sus env vars.
- **Deploy**: ejecución local; se retira la dependencia de Railway/serverless para esta feature.
