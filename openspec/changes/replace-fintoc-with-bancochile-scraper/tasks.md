## 1. Modelo y esquema

- [x] 1.1 Definir en dominio `Card` y `BalanceBucket` (tipos `cash|overdraft|credit_national|credit_international`, `limit/used/available/currency/asOf`) y ajustar `FinancialAccount` como cuenta/producto
- [x] 1.2 Ajustar `Transaction`: cuelga de la cuenta, referencia opcional a bucket, `provider` con valor `bancochile`, id externo solo para cartola (no facturados sin id)
- [x] 1.3 Migración Prisma: tablas `card`, `balance_bucket`, FKs, campos de sobregiro/ámbito/asOf; índices (upsert por id de cartola; snapshot por tarjeta)
- [x] 1.4 Actualizar invariantes: `cash` de `checking` = única caja; `overdraft`/cupos = deuda/capacidad, nunca caja; `Money` sigue prohibiendo mezclar CLP/USD (helpers `bucketIsCash`, `overdraftUsed`)
- [x] 1.5 Tests de dominio del modelo (buckets, sobregiro como deuda calculado, no mezclar monedas) — `buckets.test.ts` ✓

## 2. Contrato local y aplicación

- [x] 2.1 Definir `LocalBankConnector` (contrato orientado a resultado: accounts/cards/cartola paginada/unbilled) en dominio, sin semántica de Fintoc — `local-bank-connector.port.ts`
- [x] 2.2 Implementar `syncLocalConnection` (use-case): cuenta corriente con ventana solapada + upsert por id; primera vez ~3 meses — `sync-local-connection-use-case.ts`
- [x] 2.3 Implementar snapshot-replace atómico de no facturados (bajar+validar antes de borrar; conservar previa si falla; conteo) — orquestación en el use-case; el borrado+insert atómico va en el repo (3.x)
- [x] 2.4 No facturados como proyección: se insertan como `debit`; el repo los marca `pending` y las fórmulas existentes ya excluyen no-`confirmed` de caja/presupuesto
- [x] 2.5 Lock por conexión/perfil (una sync activa bloquea otra) — `arch/shared/mutex.ts` (`withLock`) + tests ✓. Persistencia del sync (`makeSyncLocalDeps`, Prisma) lista en `bancochile-sync.infrastructure.ts`
- [x] 2.6 Tests de aplicación con un fake `LocalBankConnector` (upsert idempotente, snapshot-replace no acumula, atómico ante fallo, 2 compras idénticas no se fusionan) — `sync-local-connection.test.ts` ✓

## 3. Conector Banco de Chile (infraestructura)

- [x] 3.1 Adapter BCH con Patchright: perfil persistente, apertura headful, espera de login del usuario (2FA), detección de sesión activa — `bancochile.connector.ts`. Llamadas vía `page.evaluate(fetch)` (único método que pasa el anti-bot; `ctx.request` recibe challenge)
- [x] 3.2 Lectura de `cuentas/saldos` + `obtenerProductos` → cuentas, tarjetas y buckets (cash/overdraft/nacional/internacional)
- [x] 3.3 Lectura de `getCartola` paginada (`paginacionDesde`) con corte por fecha (ventana) y `masPaginas`
- [x] 3.4 Lectura de `tarjeta saldo/obtener-saldo` (cupos NAC CLP + INT USD) y `movimientos-no-facturados` (snapshot)
- [x] 3.5 Mapeo crudo→dominio (CLP entero / USD a centavos, dirección cargo/abono, fecha cartola); parada dura ante 401/403/429/challenge (`BankBlockedError`)
- [ ] 3.6 Verificación en sesión limpia (anti-bot en cooldown) de los `VERIFICAR`: monto de movimientos internacionales y `nombreTitular` del payload de tarjeta; + tests de mapeo con fixtures anonimizados

## 4. Presentación (server action + UI)

- [x] 4.1 Server action local de conectar/sincronizar: `app/api/bancochile/sync/route.ts` — lanza el navegador (lock por usuario), corre `syncLocalConnection`, cierra el conector; errores mapeados (409 en curso, 422 bloqueo)
- [x] 4.2 UI de conexión: botón "Conectar Banco de Chile" (reemplaza el widget Fintoc, siempre visible en Cuentas), toast de progreso/resultado; "Nueva tarjeta" removido — `sync-bancochile-button.tsx`
- [ ] 4.3 Tarjeta de cuenta: saldo débito + saldo sobregiro (color en negativo/deuda); cupos NAC/INT separados
- [ ] 4.4 Agrupar tarjetas de crédito de una misma cuenta; distintivo "conectado" + solo lectura
- [ ] 4.5 Acción "desconectar": borra datos locales del banco (y opción de borrar perfil)

## 5. Retiro de Fintoc

- [ ] 5.1 Eliminar rutas `app/api/fintoc/*` (webhook, widget-config, connect, status, refresh, disconnect)
- [ ] 5.2 Eliminar `arch/v1/infrastructure/http/fintoc/*` y `lib/fintoc/*`; retirar el port `BankAggregationProvider` si queda sin uso
- [ ] 5.3 Quitar deps y env vars de Fintoc (secret/public key, webhook secret) del `.env`/config
- [ ] 5.4 Verificar que no queden referencias a `fintoc` (provider, tipos, UI)

## 6. Seguridad, docs y verificación

- [ ] 6.1 Perfil/cookies en ruta configurable fuera de git/backups (gitignore) con acción de borrar perfil; no persistir clave/2FA
- [ ] 6.2 Doc `docs/` del procedimiento para agregar un banco vía login guiado (referenciando los scripts de spike y las reglas: solo-lectura, parada ante bloqueo, nada de credenciales fuera del proceso local)
- [ ] 6.3 `pnpm typecheck` + `pnpm lint` + tests (`node --test`) verdes
- [ ] 6.4 Verificación end-to-end local: login real → sync cuenta corriente (upsert idempotente en 2 corridas) → tarjeta (snapshot) → UI muestra saldos/sobregiro/cupos correctos en desktop y móvil, dark/light
