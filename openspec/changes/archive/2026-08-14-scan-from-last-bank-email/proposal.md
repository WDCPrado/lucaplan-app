## Why

El escaneo inicial mira siempre el **mes calendario actual**. Si el usuario no movió ese banco este
mes —cuenta secundaria, tarjeta que usa poco, MACHBANK recién conectado— el escaneo termina sin
candidatos: el usuario todavía puede escribir sus cuentas a mano, pero pierde lo que hace útil a la
conexión —que el banco se detecte solo y su último mes se importe— aunque el buzón tenga meses de
avisos suyos.

Reportado al conectar MACHBANK: "Revisando notificaciones de este mes…" y ninguna cuenta detectada.

## What Changes

- **La ventana del escaneo parte del mes de la última notificación de ese banco**, no del mes
  calendario. Si el último aviso es de hace tres meses, se escanea ese mes; si el banco movió este
  mes, no cambia nada respecto de hoy.
- **Port nuevo `lastMessageDate(mailboxId, senders, since, until)`**: pregunta al proveedor de correo
  por la fecha del último mensaje de esos remitentes dentro de ese rango, sin descargar cuerpos. Es
  lo que permite ubicar la ventana sin traerse medio buzón. El `until` es el instante del vínculo,
  para que un correo llegado después del OAuth no mueva el mes que se escanea.
- **Tope explícito de búsqueda hacia atrás**: 6 meses. Un banco sin un solo aviso en ese plazo no
  tiene nada que importar y se comporta como hoy (escaneo vacío, el usuario agrega sus instrumentos
  a mano).
- **Escaneo y confirmación comparten el cálculo de la ventana**, para que la confirmación no importe
  un rango distinto del que el usuario revisó.
- La UI deja de prometer "este mes" mientras escanea.

## Capabilities

### New Capabilities

(ninguna)

### Modified Capabilities

- `bank-email-connection`: la ventana del escaneo inicial se define por la última notificación del
  banco en vez del mes calendario actual. Toca los dos requisitos que hoy dicen "mes actual"
  —"Configuración inicial de instrumentos y saldos" y "Carga inicial e incremental recuperable"—
  para que el contrato no quede partido.

## Impact

- `arch/v1/domain/finance/email-connection.domain.ts`: método nuevo en `BankMailProvider`.
- `arch/v1/infrastructure/http/outlook/msgraph.provider.ts`: consulta liviana a Graph (filtro por
  remitentes, sin `body`).
- `arch/v1/application/finance-use-cases/email-connection-use-cases.ts`: ventana compartida entre
  `scanEmailCandidates` y `confirmEmailSetup`.
- `components/finance/outlook-bank-connection.tsx`: texto del escaneo.
- Los fakes de `BankMailProvider` en los tests ganan el método nuevo.
- Sin migraciones ni variables de entorno. No cambia la sincronización incremental (delta/webhook),
  que arranca desde el instante de la confirmación.

---

## Revisión cruzada (Claude + Codex)

**Qué revisó Codex:** los cuatro artefactos contra el código real del escaneo, la confirmación, el
proveedor de Graph y la UI de conexión.

**Aceptado y corregido:**
- `lastMessageDate` sin cota superior no podía garantizar la misma ventana en escaneo y
  confirmación → la firma lleva `until` (el `scanUntil` del vínculo), con su escenario propio.
- El delta dejaba a medias el contrato: "Carga inicial e incremental recuperable" también exige el
  "mes calendario actual" → se modifica ese requisito en el mismo change.
- "El banco queda inconectable" era falso: el formulario permite agregar instrumentos a mano. Lo que
  se pierde es la detección e importación asistidas.
- El escenario prometía proponer "los instrumentos que aparecen ahí": con MACHBANK, una ventana de
  solo transferencias no propone cuenta (no traen número). Matizado.
- La tarea del seed ahora dice explícito que se reescribe entero: hoy contiene el de WDC-62.

**Descartado:** ninguno.

**Conclusión:** los dos bloqueos eran reales y de la misma familia —el spec prometía una ventana
estable sin darse los medios para fijarla—. Riesgo vivo: si el último correo del banco en la ventana
es una promoción o un abono, el mes elegido puede quedar sin candidatos; se acepta porque filtrarlo
obligaría a descargar cuerpos, justo lo que este diseño evita.

### Verificación post-apply (Codex, read-only)

Cobertura completa; sin deriva real (la que reportó venía de su `master` local desactualizado: la
rama sale de `cd7d2e2`, que ya trae MACHBANK). Un hallazgo bloqueante, resuelto corrigiendo el
spec:

- Cuando hay correos del banco pero ninguno produce movimientos, el código devuelve la ventana del
  mes con correos —para mostrar sus motivos de omisión— y el spec exigía el mes en curso. Gana el
  código: un mes vacío no le explica nada al usuario. Requisitos y design actualizados.

Verificaciones corridas aquí (Codex no puede ejecutarlas en su sandbox): `pnpm lint` (0 errores, 3
warnings preexistentes), `pnpm typecheck` OK, `node --test "arch/**/*.test.ts"` 359/359 OK,
`openspec validate --strict` OK.
