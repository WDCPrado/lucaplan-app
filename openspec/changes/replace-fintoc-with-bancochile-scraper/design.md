## Context

Hoy la agregación bancaria usa **Fintoc** (widget + secret key en servidor + webhook), detrás del
port `BankAggregationProvider` que consume `syncLink`. El modelo de datos es **plano**
(`Bank → FinancialAccount → Transaction`), con `overdraft_limit` y `cardLast4` como campos de la
cuenta; una tarjeta con 2 cupos se representa como 2 cuentas.

Se valida (spike guiado real con Patchright contra el portal de BCH) reemplazar Fintoc por un
**scraper local**. Hallazgos que condicionan el diseño:

- Auth por **cookies** (sin CSRF/bearer). **Sesión que expira en minutos** ⇒ no hay sync desatendido;
  se lee "en caliente" tras el login.
- Endpoints JSON estables: `GET cuentas/saldos`, `GET obtenerProductos`, `POST getCartola`
  (cuenta corriente, paginado por `paginacionDesde`, **sin** filtro de fecha de servidor, cada mov
  con **`id` estable**), `POST tarjeta saldo/obtener-saldo` (cupo nacional CLP + internacional USD),
  `POST movimientos-no-facturados` (**sin id estable**).
- Dedup probado (2 capturas, `scripts/dedup-check.mjs`): cuenta corriente `id` único y estable;
  tarjeta no facturada sin identificador estable (compras idénticas colisionan; el blob opaco se
  regenera cada fetch).
- **Anti-bot** activo en login (endpoints ofuscados tipo F5/Shape); Patchright pasó.

Sin usuarios en producción: no hay migración de datos.

## Goals / Non-Goals

**Goals:**
- Reemplazar Fintoc por un conector **local, solo-lectura**, de Banco de Chile.
- Modelo por entidades `Bank → Cuenta(FinancialAccount) → Tarjeta(Card) → Saldo(BalanceBucket)`, con
  transacciones colgando de la cuenta; sobregiro y cupos como buckets; sobregiro tratado como deuda.
- Sync pull disparado por el usuario: cuenta corriente por upsert con ventana solapada; tarjeta no
  facturada por snapshot-replace atómico.
- UI: saldo débito + sobregiro con color en negativo; cupos NAC/INT separados; tarjetas de una cuenta
  agrupadas.
- Arquitectura adaptable a otros bancos + doc del procedimiento (login guiado).

**Non-Goals:**
- Conciliación no-facturado → **facturado** y **cuotas** en presupuesto (iteración posterior; acá los
  no facturados son solo proyección).
- Port genérico multi-banco abstracto (se extrae recién con el 2º banco).
- Automatizar login/2FA o evadir anti-bot (lo hace el usuario; nos detenemos ante bloqueo).
- App de escritorio / empaquetado (se corre como app local Next en la máquina del usuario).

## Decisions

### D1 — Contrato local nuevo, no el port de Fintoc
`BankAggregationProvider` (`linkToken`, `revokeLink`, `updatedSince`) describe un proveedor remoto;
forzar un scraper de sesión efímera ahí (con `revokeLink` no-op) es semánticamente falso. Se define
`LocalBankConnector` orientado a resultado:

```
interface LocalBankConnector {
  // Lee todo en una sesión viva; el usuario ya inició sesión en la ventana.
  read(session): Promise<{
    accounts: RawAccount[];        // cuentas + cupos/saldos
    cards: RawCard[];
    cartola(accountRef, opts): AsyncIterable<RawMovement>;  // paginado
    unbilled(cardRef): RawUnbilledMovement[];               // snapshot
  }>
}
```

La estrategia de paginación/snapshot vive en el adapter BCH, no en el dominio.
*Alternativa descartada*: reusar el port de Fintoc reinterpretando parámetros → mentiras semánticas
y llamadas inválidas en el dominio.

### D2 — Modelo: `FinancialAccount → Card → BalanceBucket`, transacción en la cuenta
Un saldo/cupo es una **medición mutable** (`used/available/limit/asOf`), no el libro al que pertenece
un movimiento. Por eso `Transaction` cuelga de `FinancialAccount` y solo **referencia** un bucket
cuando el banco lo identifica sin ambigüedad (p. ej. USD internacional vs CLP nacional). Buckets:
`cash | overdraft | credit_national | credit_international`.
*Alternativa descartada*: `Transaction → Saldo` (tu primer esquema) → acopla el movimiento a una
foto mutable y se rompe al re-sincronizar. *Card* se crea solo si BCH da identidad real de plástico
(máscara `****2120`), no especulativamente.

### D3 — Sync por fuente
- **Cuenta corriente**: `getCartola` paginado; primera vez ~3 meses (corte cliente por fecha) y, si
  la paginación no permite acotar, tomar el **máximo disponible**. Incremental con **ventana de
  reconciliación solapada** (~30–90 días) y **upsert por `id`** — no "parar al primer id conocido",
  que dejaría atrás posteos tardíos/correcciones.
- **Tarjeta no facturada**: `movimientos-no-facturados` **snapshot-replace atómico** por tarjeta:
  bajar+validar la foto nueva, y en una transacción de DB borrar la anterior e insertar la nueva;
  si falla, no se toca la previa. `asOf` + conteo por snapshot.
*Alternativa descartada*: clave sintética por contenido para dedupear no facturados → colisiona con
compras idénticas reales (probado) y podría fusionar/perder movimientos.

### D4 — Sobregiro como deuda, calculado por nosotros
El banco **suma la línea al "disponible"** (registra ingreso desde el sobregiro), así que su
"disponible" NO es caja. El bucket `overdraft` calcula el usado = `montoAutorizadoLinea −
saldoDisponibleLinea` (≥ 0; el saldo del sobregiro es su negativo: 1M − 1M = 0 sin usar; 900k − 1M =
−100k con 100k usado). No se confía en el "disponible" del banco ni se toma como caja.
*Alternativa descartada*: tomar `montoUtilizadoLinea` o `saldoFinal` a secas → el banco los presenta
de forma confusa (el disponible incluye la línea); calcularlo desde línea autorizada vs disponible es
más seguro.

### D5 — Ejecución: userscript en el navegador del usuario (no server-side)
**Pivote validado empíricamente:** lanzar un navegador desde el servidor (Patchright headful, perfil
persistente) es lo que el **anti-bot de BCH marca** — deja pasar el primer login pero bloquea ráfagas
de un navegador automatizado/fresco. El navegador normal del usuario (perfil de confianza) entra sin
problema. Por eso la lectura corre **en el navegador real del usuario** vía un **userscript**
(Tampermonkey): tras loguearse normal, un botón flotante lee las APIs internas (misma sesión, sin
automatización → sin anti-bot) y postea el JSON crudo a `POST /api/bancochile/ingest`. El servidor lo
mapea (mapeo puro compartido) y persiste con `syncLocalConnection`. Auth de ingesta por **token
stateless** (HMAC del userId). `GM_xmlhttpRequest` saltea CORS/CSP hacia localhost. El servidor **no**
bundlea Patchright (evita el error `chromium-bidi` de Turbopack). Progreso vía toast.
*Alternativas descartadas*: (a) Patchright server-side → anti-bot lo bloquea; (b) adjuntar a Chrome por
CDP → sigue habiendo señales de automatización; (c) Electron → sobredimensionado. El conector Patchright
(`bancochile.connector.ts`) queda como referencia/fallback, no en la ruta de la app.

### D6 — Seguridad local
Perfil/cookies en ruta configurable **fuera de git/backups** (gitignored), permisos del usuario del
SO; **no** se persiste contraseña ni 2FA; "desconectar" borra datos locales del banco y opcionalmente
el perfil. Detención dura ante `401/403/429`/challenge, sin evadir.

## Risks / Trade-offs

- **Portal cambia / anti-bot bloquea** → el scraper es frágil por naturaleza. Mitigación: leer APIs
  JSON internas (no HTML), detenerse ante bloqueo, mensajes claros de "reintenta el login", tests del
  mapeo contra fixtures capturados.
- **Sesión efímera** → no hay sync en background. Mitigación asumida: sync es una acción con el
  usuario presente; la UX lo comunica ("inicia sesión para sincronizar").
- **No facturado sin id** → no se puede dedupear ni categorizar por ítem de forma segura. Mitigación:
  snapshot-replace + tratarlos como proyección fuera del presupuesto; conciliación queda para después.
- **Doble conteo no-facturado/facturado** → se evita dejando los no facturados fuera del gasto
  realizado hasta que se facturen.
- **Concurrencia de sync** (dos syncs sobre el mismo perfil) → exclusión mutua por perfil (lock);
  una sync activa bloquea otra.
- **Fixtures con datos personales** (`scripts/.bch-local/`) → gitignored; los tests usan fixtures
  anonimizados/reducidos, no los reales.

## Migration Plan

1. Introducir modelo nuevo (Card, BalanceBucket, provider `bancochile`) por migración Prisma; sin
   datos productivos que convertir.
2. Implementar el conector BCH + `syncLocalConnection` en paralelo, detrás de la server action.
3. Retirar Fintoc (rutas `app/api/fintoc/*`, `http/fintoc/*`, `lib/fintoc/*`, deps, env vars) una vez
   el flujo local funciona end-to-end.
4. Rollback: como es local y sin usuarios, revertir el branch; no hay estado remoto que deshacer.

## Open Questions

Todas resueltas (decisiones del usuario):
- **Sobregiro usado** = `montoAutorizadoLinea − saldoDisponibleLinea` (calculado por nosotros; el
  banco infla el "disponible" con la línea, así que no se toma como caja). La fórmula es **robusta
  por construcción**: da 0 con la línea sin usar (caso del spike: 1M − 1M = 0) y el monto de deuda
  correcto al girar contra la línea (900k − 1M = −100k). No depende de `saldoFinal` (que el banco
  puede dejar positivo mostrando el giro como ingreso). Ver D4.
- **Ventana inicial**: apuntar a ~3 meses; si la paginación no permite acotar, tomar el máximo
  disponible. Ver D3.
- **Progreso de sync**: toast (sonner) mientras el usuario está en la web. Ver D5.
