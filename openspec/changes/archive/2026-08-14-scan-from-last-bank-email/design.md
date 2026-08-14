## Context

`scanEmailCandidates` y `confirmEmailSetup` calculan su ventana con `firstDayOfMonth(scanUntil)`,
donde `scanUntil` es el instante en que se creó el vínculo. Eso asume que el banco movió plata este
mes. Cuando no la movió, el escaneo devuelve cero candidatos y `confirmEmailSetup` rechaza el setup
("Confirma al menos un instrumento"), así que el banco no se puede conectar.

El costo de traer correo no es despreciable: `listMessagesSince` pide a Graph `id, subject, from,
receivedDateTime, internetMessageId, body` con tope de 2000 mensajes. Traerse seis meses de inbox
completo solo para ubicar una fecha sería caro y, con buzones voluminosos, además truncaría.

## Goals / Non-Goals

**Goals:**

- Conectar un banco cuyo último aviso es de un mes anterior.
- Ubicar la ventana sin descargar cuerpos de correo.
- Que escaneo y confirmación recorran exactamente el mismo rango.

**Non-Goals:**

- Importar histórico: se sigue trayendo **un** mes, el que tenga la última actividad. Traer todo lo
  que exista es otra discusión (afecta presupuestos de meses cerrados).
- Tocar la sincronización incremental: delta y webhook arrancan en la confirmación y no cambian.
- Cambiar el `scanUntil` (instante del vínculo), que es lo que cierra la carga inicial.

## Decisions

### 1. Un método nuevo en el port: `lastMessageDate(mailboxId, senders, since, until)`

Devuelve la fecha del mensaje más reciente de esos remitentes dentro de `[since, until]`, o `null`.
Graph filtra por remitente y por fecha del lado del servidor y se piden solo `receivedDateTime`: la
consulta es liviana y no depende del volumen del buzón.

El `until` va en la firma y no como un filtro posterior: sin él, un aviso llegado después del OAuth
sería la "última notificación" y movería la ventana, con lo que el escaneo y la confirmación podrían
mirar meses distintos. `until` es siempre el `scanUntil` del vínculo, el mismo instante que ya cierra
la carga inicial.

Alternativas descartadas:

- **Traer 6 meses con `listMessagesSince` y filtrar en memoria**: descarga hasta 2000 correos con
  sus cuerpos para leer una fecha. Caro, lento y trunca en buzones grandes.
- **Retroceder mes a mes llamando `listMessagesSince`**: hasta 6 llamadas, cada una re-descargando
  el rango completo. Mismo problema, repartido.
- **`$orderby=receivedDateTime desc` + `$top=1`**: sería la consulta ideal, pero Graph rechaza
  combinaciones de `$filter` y `$orderby` sobre propiedades distintas ("The restriction or sort
  order is too complex"). Se filtra por remitentes **y** fecha, y el máximo se calcula sobre el
  puñado de resultados, que son solo los avisos del banco.

### 2. Se retrocede hasta un mes que produzca movimientos, no solo hasta un mes con correos

La fecha del último correo no basta: `contacto@mail.machbank.cl` manda marketing, y un aviso de
transferencia recibida se descarta a propósito. Si la ventana se fijara en el mes de ese correo,
podría no traer un solo movimiento y el problema seguiría en pie, solo que un mes más atrás.

Por eso el escaneo es un bucle acotado: ubicar el mes con actividad → traer y parsear ese mes → si
ningún correo produjo evento, volver a preguntar por el último correo **anterior a esa ventana** y
repetir. En el caso normal —el último aviso es un movimiento— es una sola vuelta, igual que hoy.

Para que traer ese mes no arrastre todo lo posterior, `listMessagesSince` acepta un `until`
opcional: la descarga queda en el mes elegido en vez de ir desde un mes viejo hasta hoy, que además
podría truncarse contra el tope de páginas del proveedor y perder justo los correos buscados.

### 3. Tope de 6 meses hacia atrás, y qué se muestra si no se encuentra nada

Constante en el use-case, no configurable. Un banco sin un solo aviso en medio año no tiene nada que
importar, y el tope mantiene la consulta acotada.

Si se agotan los meses sin encontrar movimientos, la ventana que se devuelve es la **más reciente con
correos suyos**, no el mes en curso: sus motivos de omisión (`asunto_desconocido`, `abono_ignorado`…)
son justamente lo que explica al usuario por qué no se detectó nada, y un mes en curso vacío no dice
nada. Sin ningún correo del banco en el plazo, ahí sí se cae al mes en curso, que es el
comportamiento de hoy.

### 4. La ventana se calcula en un solo lugar

Una función que usan ambos use-cases devuelve el `since`. Si cada uno lo calculara por su lado, un
correo que llegara entre el escaneo y la confirmación podría mover la ventana y hacer que se importe
un rango distinto del que el usuario revisó. Como los dos parten del mismo `scanUntil` (derivado de
`link.createdAt`, que no cambia) y la consulta va acotada por él, el resultado es estable aunque el
buzón siga recibiendo correo.

### 5. La UI deja de decir "este mes"

El texto pasa a hablar de las notificaciones del banco sin prometer un mes concreto. El rango real ya
viaja en `ScanResult.since` para cuando se quiera mostrar.

## Risks / Trade-offs

- **Una llamada extra a Graph por escaneo** → es la más barata del flujo (sin cuerpos, filtrada por
  remitente) y solo ocurre en el setup, no en la sincronización.
- **Hasta 6 vueltas del bucle en el peor caso** (un banco que solo mandó marketing durante medio
  año): son consultas de fechas más un mes de correo cada una, y solo ocurre en el setup. El caso
  normal es una vuelta.
- **Los movimientos importados quedan en un mes cerrado** cuando la ventana es vieja: entran como
  gasto de su fecha real y quedan anteriores al snapshot, así que no re-descuentan saldo. Es el
  comportamiento que ya existe para los movimientos previos al snapshot dentro del mes.
