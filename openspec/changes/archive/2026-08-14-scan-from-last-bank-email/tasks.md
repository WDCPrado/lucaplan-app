## 1. Port y proveedor

- [x] 1.1 Agregar `lastMessageDate(mailboxId, senders, since, until)` a `BankMailProvider` (`email-connection.domain.ts`), documentando que no descarga cuerpos y por qué lleva `until`
- [x] 1.2 Implementarlo en `msgraph.provider.ts`: filtro por remitentes + `receivedDateTime` entre `since` y `until`, `$select=receivedDateTime`, paginación acotada, máximo en memoria

## 2. Ventana del escaneo

- [x] 2.1 `listMessagesSince` acepta un `until` opcional (port + proveedor Graph), para que traer un mes viejo no arrastre todo lo posterior ni trunque contra el tope de páginas
- [x] 2.2 Función compartida en `email-connection-use-cases.ts` que devuelva la ventana y los mensajes ya parseados: retrocede mes a mes con actividad del banco hasta encontrar uno con movimientos (tope de 6 meses, acotada por `scanUntil`, fallback al mes en curso)
- [x] 2.3 Usarla en `scanEmailCandidates` y en `confirmEmailSetup` en vez de `firstDayOfMonth(scanUntil)`

## 3. UI

- [x] 3.1 Cambiar el texto "Revisando notificaciones de este mes…" para que no prometa el mes en curso
- [x] 3.2 Quitar `"BICE"` de `COMING_SOON` en `sync-bancochile-button.tsx` (ya está soportado y aparece en "Próximamente")

## 4. Tests (`node --test`)

- [x] 4.1 Actualizar los fakes de `BankMailProvider` de los tests existentes con el método nuevo
- [x] 4.2 Banco sin movimientos este mes: el escaneo usa el mes del último aviso y propone sus candidatos
- [x] 4.3 El mes de la última notificación solo trae promociones/abonos: sigue hacia atrás hasta el mes con movimientos
- [x] 4.4 Banco sin avisos útiles en el plazo máximo: escaneo vacío, sin reventar ni buscar sin fin
- [x] 4.5 La confirmación pide el mismo rango que el escaneo (incluso si llega un correo nuevo entremedio)
- [x] 4.6 Un aviso posterior a `scanUntil` no mueve la ventana

## 5. Documentación y verificación

- [x] 5.1 Reflejar la ventana en `docs/bank-email-contract.md` si corresponde
- [x] 5.2 `pnpm lint`, `pnpm typecheck`, `node --test "arch/**/*.test.ts"` y `openspec validate --strict`
- [x] 5.3 Reescribir `scripts/seed-pr-feature.ts` ENTERO para este PR (hoy tiene el de WDC-62/MACHBANK): sembrar solo lo que deje verificable este cambio, o dejarlo no-op si no se puede sin Outlook real
