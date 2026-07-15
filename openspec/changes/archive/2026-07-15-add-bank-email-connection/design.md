## Context

Banco de Chile ya está siendo integrado mediante un scraper local que lee saldos, cartolas y no facturados después del login interactivo. Esa conexión no puede sincronizarse desatendida. En la cuenta Outlook analizada existen notificaciones estructuradas suficientes para cubrir una parte útil de los gastos: en una muestra reciente aparecieron cientos de `Cargo en Cuenta` y `Compra con Tarjeta de Crédito`, además de `Transferencia a Terceros` y `Transferencias de Fondos a <comercio>` con ID TEF.

El correo es una fuente distinta y menos completa: no informa un saldo consolidado confiable, no refleja con fiabilidad todos los reversos o ajustes y algunas compras no tienen un ID bancario. Por decisión de producto, Banco de Chile podrá usar scraper **o** correo, nunca ambos simultáneamente. Esto elimina la necesidad de reconciliar dos fuentes imperfectas. Para el método correo, el usuario ingresará un snapshot inicial y LucaPlan mostrará una proyección desde ese punto.

Microsoft Graph soporta cuentas personales, lectura delegada, delta de mensajes y notificaciones de cambio. La API de correo no está entre las APIs actualmente cobradas por uso medido; para esta cuenta el costo incremental esperado es cero más el hosting existente. Gmail API tampoco cobra su uso normal y Pub/Sub incluye 10 GiB mensuales sin costo, pero `gmail.readonly` es un scope restringido y una aplicación pública que procesa correo en servidor puede requerir verificación y auditoría de seguridad anual. Por ello Outlook es el único proveedor de la primera versión.

## Goals / Non-Goals

**Goals:**

- Conectar una cuenta Outlook personal con OAuth y permiso mínimo `Mail.Read`.
- Importar automáticamente gastos y transferencias salientes CLP y compras de tarjeta USD de Banco de Chile con reglas auditables.
- Configurar un snapshot inicial de caja, sobregiro y cupos nacional/internacional, y proyectarlo con los correos posteriores.
- Garantizar un único método de conexión activo por banco.
- Evitar duplicados ante carga inicial, reintentos de webhook y recuperación por delta.
- Mantener tokens y validación del webhook fuera del cliente.

**Non-Goals:**

- Implementar Gmail en esta iteración.
- Usar scraper y correo a la vez, migrar movimientos entre ambos o conciliarlos.
- Contar abonos recibidos o pagos internos como ingreso, gasto o presupuesto; solo podrán ajustar la proyección de balance.
- Presentar la proyección como saldo bancario autoritativo, convertir USD a CLP o inferir movimientos que no generen correo.
- Interpretar cartolas, PDFs, intereses o ajustes bancarios ambiguos.
- Crear un motor genérico de reglas bancarias o agregar dependencias para parsear HTML.

## Decisions

### 1. Un método activo por banco

`Bank` conservará `provider = bancochile` como identidad/origen bancario y agregará un método de conexión explícito (`scraper` o `email`). La base de datos y los casos de uso rechazarán una segunda conexión activa para el mismo usuario y banco. La UI pedirá desconectar antes de cambiar.

Desconectar revocará la suscripción y el token aplicable y eliminará el banco conectado con sus cuentas/movimientos, igual que el flujo de desconexión actual. No se preservarán ni mezclarán transacciones entre métodos.

**Alternativa descartada:** mantener ambos métodos y deduplicar por monto/fecha/comercio. Los correos de compra carecen de ID de operación y dos compras idénticas son válidas; la heurística produciría pérdidas o duplicados.

### 2. Outlook primero, con capacidades nativas

Se usará OAuth 2.0 con Authorization Code + PKCE, estado firmado y permiso delegado `Mail.Read`; no se solicitarán permisos de envío o modificación. Microsoft Graph se consumirá con `fetch` nativo, sin SDK nuevo.

Una `EmailConnection` mínima guardará: usuario, banco, proveedor de correo, dirección, refresh token cifrado, estado/delta link, subscription ID y expiración, `clientState` cifrado o derivado, estado y marcas de última sincronización/error. El refresh token se cifrará con AES-256-GCM y una llave derivada con propósito separado del cifrado de credenciales bancarias existente.

**Alternativa descartada:** implementar desde el inicio una abstracción multi-proveedor completa. Gmail no se implementará hasta que exista demanda que justifique su cumplimiento OAuth.

### 3. Carga inicial y sincronización resiliente

Tras OAuth se leerá el Inbox desde el primer día del mes calendario actual hasta el instante de conexión y se persistirá el `deltaLink`. Las notificaciones de Graph serán livianas: validación del token de Microsoft, comprobación de `clientState` y recuperación del mensaje desde Graph antes de procesarlo. La suscripción se renovará diariamente porque Outlook limita su duración a menos de siete días.

Un refresco manual y una ejecución periódica de delta recuperarán notificaciones perdidas. El webhook puede acusar recibo y serializar la sincronización por conexión; no hace falta una cola para el volumen personal actual. En local, donde no existe HTTPS público, seguirá funcionando OAuth/carga/refresco manual; el webhook automático requiere el despliegue HTTPS.

### 4. Allowlist y parser puro de Banco de Chile

Solo se procesarán combinaciones conocidas:

| Remitente exacto | Asunto | Resultado |
|---|---|---|
| `enviodigital@bancochile.cl` | `Cargo en Cuenta` | débito CLP en cuenta terminada en los 4 dígitos informados |
| `enviodigital@bancochile.cl` | `Compra con Tarjeta de Crédito` | débito CLP o USD en el cupo correspondiente de la tarjeta informada |
| `serviciodetransferencias@bancochile.cl` | `Transferencia a Terceros` | débito CLP con destinatario e ID TEF |
| `serviciodetransferencias@bancochile.cl` | prefijo `Transferencias de Fondos a ` | débito CLP con comercio/destinatario e ID TEF |

Se rechazarán por defecto remitentes/asuntos desconocidos. `Aviso de transferencia de fondos` y comprobantes de pago de tarjeta/línea podrán leerse únicamente como eventos internos de balance: se guardan con `isInternal = true`, no llevan categoría y no cuentan en presupuesto. Cartolas, intereses y ajustes ambiguos se ignoran. El parser extraerá texto desde el cuerpo HTML con reglas acotadas, sin ejecutar contenido ni descargar adjuntos/recursos remotos. Los fixtures de prueba serán sanitizados y no contendrán destinatarios, RUT, cuentas o correos reales.

Para `Cargo en Cuenta`, la plantilla vigente contiene la frase `compra por <monto> con cargo a Cuenta <cuenta> en <comercio> el <fecha>`. El parser deberá reconocer esa estructura y guardar el comercio como descripción. El asunto del correo representa la fuente bancaria, no el título útil del movimiento.

### 5. Asistente inicial de instrumentos y saldos

Después de OAuth, LucaPlan escaneará primero los mensajes del mes para descubrir números de cuenta y últimos cuatro dígitos. `Cargo en Cuenta` propone una cuenta/tarjeta de débito; `Compra con Tarjeta de Crédito` propone una tarjeta de crédito. Cargos CLP y USD con el mismo último 4 y tipo se agrupan en una sola `Card` con buckets distintos, nunca en dos tarjetas.

El resultado se devuelve como candidatos, sin crear aún `Bank`, `FinancialAccount`, `Card`, `BalanceBucket` ni `Transaction`. La UI muestra instrumentos, últimos 4, moneda/cupos detectados y cantidad de movimientos. El usuario puede corregir el agrupamiento o agregar una tarjeta sin actividad ese mes; refrescar la página simplemente obliga a reescanear, evitando un modelo de borradores.

Después de validar los candidatos, el usuario registra un snapshot con fecha/hora:

- Cuenta corriente: saldo propio disponible CLP y, solo si aplica, línea total y sobregiro disponible. `used = limitAmount - available`.
- Cada tarjeta de crédito: cupo total y disponible nacional CLP y, si aplica, cupo total y disponible internacional USD. En ambos, `used = limitAmount - available`.

La UI validará `0 <= available <= limitAmount` y enviará al contrato de dominio el `used` derivado. Así se conserva `BalanceBucket` sin migración y se presenta al usuario el mismo concepto que muestran las tarjetas del dashboard.

El modelo vigente ya contiene `BalanceBucket` para `cash`, `overdraft`, `credit_national` y `credit_international`; no se creará otro modelo de saldos. Tras confirmar, una única operación crea instrumentos/buckets y luego importa los movimientos del mes apuntando a su cuenta, tarjeta y bucket. La conexión guarda `lastBalanceReconciledAt`. Los movimientos del mes hasta ese snapshot se crean para historial/presupuesto, pero **no** vuelven a modificar los saldos ingresados; solo eventos posteriores actualizan buckets.

El usuario podrá ejecutar “Actualizar saldos” para reemplazar los cuatro valores aplicables y mover `lastBalanceReconciledAt`. Esto corrige correos faltantes, reversos o ajustes sin inventar reglas.

### 6. Identidad, cuenta destino y proyección

Para transferencias se preferirá `externalId = email:<ID-TEF>`; para compras/cargos se usará `email:<internetMessageId>` (o el ID inmutable de Graph como respaldo). El upsert existente por `(accountId, externalId)` preservará la categoría.

Las cuentas/tarjetas se identificarán por los últimos cuatro dígitos o el número de cuenta presente en el correo. Un mensaje sin mapeo inequívoco quedará registrado como omitido y no se importará en una cuenta inventada. Los movimientos serán confirmados y de solo lectura. Los USD cuelgan del bucket internacional y nunca se suman a presupuesto CLP.

Las reglas de proyección serán pequeñas y deterministas:

- Débito/transferencia CLP: consume primero `cash.available`; el exceso aumenta `overdraft.used` y reduce `overdraft.available`.
- Abono recibido: reduce primero `overdraft.used`; el remanente aumenta `cash.available`. Queda interno y fuera del presupuesto.
- Compra con tarjeta: aumenta `used` y reduce `available` del bucket nacional CLP o internacional USD.
- Pago de tarjeta/línea identificado: reduce la deuda del bucket aplicable, nunca por debajo de cero. Queda interno y fuera del presupuesto.
- Ajuste o reverso sin identidad inequívoca: no modifica automáticamente el bucket; exige reconciliación manual.

La UI mostrará “Saldo estimado desde <fecha>” junto con última sincronización y botón de reconciliación. Nunca lo rotulará como saldo informado por Banco de Chile.

Después de vincular cada movimiento, los no internos se envían al categorizador existente. Una falla de IA no revierte la importación: el movimiento queda sin categoría para revisión manual. Los abonos/pagos `isInternal` nunca se categorizan.

### 7. Revisión inmediata en tarjetas editables

Al volver del OAuth, la UI iniciará automáticamente el escaneo pendiente y sustituirá el botón intermedio por un estado de carga breve. Los candidatos se mostrarán dentro del modal como tarjetas editables que reutilizan el arte, jerarquía y posiciones de datos de `AccountCard`: banco y últimos cuatro arriba, saldo o cupo disponible como dato principal, total como dato secundario y los inputs integrados en la propia tarjeta.

Los campos monetarios reutilizarán `useMoneyInput` y la fuente única de formato. CLP acepta enteros agrupados; USD conserva dos decimales y muestra coma decimal en locale `es-CL`. No se añadirá una dependencia ni un segundo sistema de componentes. La transición de carga a candidatos comunicará cambio de estado, sin animación ornamental.

## Risks / Trade-offs

- **[Un movimiento puede no generar correo y desviar la proyección]** → mostrar fecha del snapshot y ofrecer “Actualizar saldos”.
- **[Banco de Chile cambia una plantilla]** → parser fail-closed, registrar asunto/motivo sin cuerpo sensible y probar fixtures sanitizados por plantilla.
- **[Graph pierde o duplica notificaciones]** → delta periódico, refresco manual e idempotencia por identidad externa.
- **[Suscripción expira]** → renovación diaria y alerta de estado; la expiración no pierde datos porque delta recupera el intervalo.
- **[Revocación o expiración OAuth]** → marcar `reauth_required`, detener sync y solicitar reconexión sin borrar datos automáticamente.
- **[Reversos/ajustes incompletos]** → aplicar solo correcciones con identidad inequívoca; los demás se resuelven reemplazando el snapshot.
- **[Colisión de últimos cuatro dígitos]** → exigir selección manual; nunca adivinar la cuenta.
- **[Tarjeta sin movimientos durante el mes no puede detectarse]** → permitir agregarla manualmente en la revisión antes de confirmar.
- **[Acceso a correo sensible]** → scope mínimo, tokens cifrados, cuerpos no persistidos, logs sin PII y borrado/revocación al desconectar.

## Migration Plan

1. Partir del esquema y comportamiento ya implementados por `replace-fintoc-with-bancochile-scraper`.
2. Agregar la conexión de correo y el método exclusivo sin alterar bancos manuales ni activar migraciones para usuarios existentes.
3. Desplegar OAuth, carga/refresco manual y parser detrás de la opción Outlook.
4. Configurar webhook y renovación solo después de disponer de URL HTTPS y credenciales Microsoft de producción.
5. Rollback: deshabilitar la opción Outlook y revocar suscripciones/tokens; el scraper continúa sin cambios. La migración aditiva puede permanecer sin afectar el flujo vigente.

## Open Questions

- Ninguna decisión funcional bloqueante. Antes de implementar se deberán registrar el redirect URI y la URL de webhook definitivos en Microsoft Entra; son configuración operativa, no un cambio de alcance.
