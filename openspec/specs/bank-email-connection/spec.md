# bank-email-connection

## Purpose

Conexión bancaria por notificaciones de correo: OAuth de Outlook (Microsoft Graph, permiso mínimo
`Mail.Read`), exclusividad del método de conexión por banco, filtrado fail-closed de notificaciones
de Banco de Chile, carga inicial del mes y sincronización incremental (webhook + delta), snapshot
manual de saldos con proyección estimada, e importación idempotente con categorización IA. Los
saldos resultantes son proyecciones desde el último snapshot, nunca saldos reportados por el banco.

## Requirements

### Requirement: Un único método activo por banco

El sistema SHALL permitir que Banco de Chile use `email` como método de conexión y MUST mantener como máximo un método activo por usuario y banco. Para cambiar o rehacer la conexión, el usuario MUST desconectar primero la conexión vigente. El sistema SHALL NOT combinar, conciliar ni deduplicar movimientos entre métodos de conexión distintos.

#### Scenario: Intento de conectar con otro método activo
- **WHEN** el usuario intenta conectar Outlook para Banco de Chile mientras ese banco ya tiene otro método de conexión activo
- **THEN** el sistema rechaza la conexión y solicita desconectar primero el método vigente

#### Scenario: Cambio después de desconectar
- **WHEN** el usuario desconecta Banco de Chile y luego conecta Outlook
- **THEN** el sistema crea una nueva conexión Banco de Chile con método `email`, sin reutilizar ni mezclar movimientos anteriores

### Requirement: Conexión Outlook de solo lectura

El sistema SHALL conectar una cuenta Outlook personal mediante OAuth 2.0 Authorization Code con PKCE, estado verificable y el permiso delegado mínimo `Mail.Read`. El refresh token MUST permanecer cifrado en servidor y ningún token SHALL exponerse al cliente o registrarse en logs. El sistema SHALL NOT solicitar permisos para enviar, modificar o eliminar correo.

#### Scenario: Autorización exitosa
- **WHEN** el usuario autoriza `Mail.Read` y Microsoft devuelve un código válido asociado al estado iniciado por LucaPlan
- **THEN** el sistema guarda la conexión y el refresh token cifrado, sin exponerlo al navegador

#### Scenario: Callback con estado inválido
- **WHEN** el callback OAuth contiene un estado ausente, expirado o inválido
- **THEN** el sistema rechaza la conexión y no persiste tokens

### Requirement: Filtrado cerrado de notificaciones Banco de Chile

El sistema SHALL crear movimientos de gasto únicamente desde remitentes exactos de Banco de Chile y estos asuntos: `Cargo en Cuenta`, `Compra con Tarjeta de Crédito`, `Transferencia a Terceros` o el prefijo `Transferencias de Fondos a `. El asunto `Comprobante Pago Credito Consumo` SHALL producir un gasto CLP. MAY procesar `Aviso de transferencia de fondos` y comprobantes de pago de tarjeta/línea exclusivamente como movimientos internos de balance. Todo correo que no coincida con estas reglas SHALL ser ignorado. Los cuerpos y datos personales del correo SHALL NOT persistirse una vez extraído el evento necesario. Cuando una plantilla permitida incluya comercio o destinatario, el sistema MUST usar ese detalle como descripción del movimiento y SHALL NOT sustituirlo por el asunto genérico del correo.

#### Scenario: Compra con cargo en cuenta
- **WHEN** llega desde `enviodigital@bancochile.cl` un correo `Cargo en Cuenta` con la frase `compra por <monto> con cargo a Cuenta <cuenta> en <comercio> el <fecha>`
- **THEN** el sistema genera un débito CLP para la cuenta mapeada y usa `<comercio>` como descripción antes de categorizar

#### Scenario: Transferencia saliente
- **WHEN** llega desde `serviciodetransferencias@bancochile.cl` una `Transferencia a Terceros` o `Transferencias de Fondos a <comercio>` CLP con ID TEF
- **THEN** el sistema genera un débito CLP con ese ID TEF como identidad bancaria estable

#### Scenario: Remitente o asunto desconocido
- **WHEN** llega un correo cuyo remitente o asunto no coincide exactamente con la allowlist
- **THEN** el sistema lo ignora sin crear una transacción

#### Scenario: Aviso permitido solo para balance
- **WHEN** llega un abono recibido o pago de producto financiero desde un remitente y asunto interno permitido
- **THEN** el sistema puede ajustar el bucket aplicable, pero marca el movimiento `isInternal` y no lo categoriza ni cuenta en presupuesto

### Requirement: Operaciones internas fuera del presupuesto

El sistema MUST excluir del ingreso, gasto categorizable y presupuesto los abonos recibidos, avisos de transferencia entrante y pagos de tarjeta/línea/crédito. Cuando el correo identifique inequívocamente monto, moneda e instrumento, el sistema MAY conservarlo como movimiento `isInternal` para actualizar una proyección de balance. Cartolas, intereses y ajustes/reversos ambiguos SHALL ser ignorados.

#### Scenario: Abono recibido
- **WHEN** llega `Aviso de transferencia de fondos`, `Notificación de abono` o un equivalente que representa dinero transferido al usuario
- **THEN** no cuenta como ingreso ni presupuesto; si identifica la cuenta destino, reduce sobregiro usado y luego aumenta caja como movimiento interno

#### Scenario: Pago o ajuste interno
- **WHEN** llega un comprobante inequívoco de pago de línea de crédito, tarjeta o crédito
- **THEN** reduce la deuda estimada del bucket aplicable, queda interno y no cuenta en presupuesto

#### Scenario: Pago de cuota de crédito de consumo
- **WHEN** llega desde `serviciodetransferencias@bancochile.cl` un `Comprobante Pago Credito Consumo` con `Monto Pagado` y una cuenta de cargo identificable en `Datos de Origen`
- **THEN** el sistema genera un **gasto** CLP por el monto pagado (nunca el interés como monto total) que reduce la caja de esa cuenta corriente, cuenta en presupuesto y se envía al categorizador de IA
- **AND** SHALL NOT tratarse como movimiento interno: a diferencia del pago de tarjeta —cuya compra ya se registró el día que ocurrió— el consumo financiado por el crédito nunca ingresó al sistema, y la cuota incluye intereses
- **AND** SHALL NOT mapearse a un bucket de tarjeta ni de sobregiro; el N° de crédito SHALL NOT persistirse ni registrarse; sin `Monto Pagado` o sin cuenta identificable el correo se omite

#### Scenario: Compra en USD
- **WHEN** un correo permitido representa una compra USD en una tarjeta mapeada
- **THEN** crea un débito USD en `credit_international`, aumenta su usado y no mezcla el monto con presupuesto CLP

#### Scenario: Ajuste ambiguo
- **WHEN** llega una cartola, interés, ajuste o reverso sin identidad inequívoca del movimiento original
- **THEN** el sistema lo ignora y conserva la proyección hasta que el usuario reconcilie saldos

### Requirement: Configuración inicial de instrumentos y saldos

Después de autorizar Outlook, el sistema SHALL escanear desde el primer día del mes actual hasta el instante de conexión y descubrir candidatos de cuentas/tarjetas por número o últimos cuatro dígitos. Cargos nacionales CLP e internacionales USD del mismo último 4 y tipo crediticio MUST proponerse como una sola tarjeta con dos buckets, no como dos tarjetas. Antes de crear entidades financieras o transacciones, la UI SHALL mostrar los candidatos y exigir que el usuario confirme, corrija o agregue instrumentos faltantes.

Después de validar, el usuario MUST registrar un snapshot con fecha/hora: saldo propio disponible de la cuenta corriente; límite y disponible de sobregiro si aplica; y, para cada tarjeta de crédito, límite y disponible nacional CLP e internacional USD si aplica. El sistema SHALL validar `0 <= available <= limitAmount`, calcular `used = limitAmount - available` y SHALL reutilizar los buckets `cash`, `overdraft`, `credit_national` y `credit_international` existentes.

#### Scenario: Cuenta corriente con sobregiro
- **WHEN** el usuario valida la cuenta e informa caja CLP, límite total y sobregiro disponible
- **THEN** el sistema crea `cash` y `overdraft`, deriva el usado y guarda la fecha del snapshot

#### Scenario: Cuenta corriente sin sobregiro
- **WHEN** el usuario valida la cuenta, informa su caja CLP y marca que no tiene sobregiro
- **THEN** el sistema crea `cash` sin exigir ni inventar un bucket `overdraft`

#### Scenario: Tarjeta con dos cupos
- **WHEN** los correos del mes muestran cargos CLP y USD con el mismo último 4 de tarjeta de crédito y el usuario valida el agrupamiento
- **THEN** el sistema crea una sola `Card` con `credit_national` y `credit_international`, usando cupo total/disponible ingresados, derivando el usado y sin sumar monedas

#### Scenario: Escaneo visible inmediatamente después de OAuth
- **WHEN** el usuario vuelve del OAuth con una conexión pendiente de configuración
- **THEN** la UI inicia el escaneo sin exigir otro clic y muestra directamente las cuentas y tarjetas detectadas cuando termina

#### Scenario: Instrumentos editables con diseño bancario
- **WHEN** el escaneo detecta una cuenta o tarjeta
- **THEN** la UI la presenta como una tarjeta editable con el arte del banco, últimos cuatro y campos de saldo o cupo dentro de la misma superficie y jerarquía visual del dashboard

#### Scenario: Entrada monetaria CLP y USD
- **WHEN** el usuario edita un monto CLP o USD en una tarjeta detectada
- **THEN** la UI reutiliza el formateador monetario vigente, muestra CLP sin decimales y USD con dos decimales y coma decimal `es-CL`, conservando el valor numérico exacto

#### Scenario: Disponible supera el total
- **WHEN** el usuario informa un disponible negativo o mayor que el cupo total
- **THEN** el sistema muestra un error en el instrumento y no permite confirmar el snapshot

#### Scenario: Revisión antes de crear
- **WHEN** finaliza el escaneo inicial
- **THEN** la UI muestra tipo, últimos 4, monedas detectadas y conteo de movimientos, sin haber creado aún cuentas, tarjetas, buckets o transacciones

#### Scenario: Tarjeta sin movimientos este mes
- **WHEN** una tarjeta real no aparece entre los candidatos porque no tuvo notificaciones durante el mes
- **THEN** el usuario puede agregarla y definir sus cupos antes de confirmar

#### Scenario: Instrumento sin saldo confirmado
- **WHEN** el escaneo descubre una cuenta o tarjeta pero el usuario no confirma su mapeo y snapshot
- **THEN** el sistema no crea ni importa ese instrumento

### Requirement: Proyección y reconciliación de balances

Solo los eventos posteriores al snapshot vigente SHALL actualizar balances estimados. Un débito CLP MUST consumir primero caja y luego aumentar sobregiro usado; un abono interno MUST reducir primero sobregiro usado y después aumentar caja. Una compra de crédito MUST aumentar `used` y reducir `available` del cupo de su moneda; un pago interno inequívoco MUST reducir `used` sin dejarlo bajo cero. El usuario SHALL poder reemplazar los valores estimados mediante “Actualizar saldos”, creando un nuevo snapshot.

#### Scenario: Débito usa caja y sobregiro
- **WHEN** entra un débito CLP posterior al snapshot por un monto mayor que la caja disponible
- **THEN** la caja estimada queda en cero y el exceso aumenta el sobregiro usado

#### Scenario: Compra nacional e internacional
- **WHEN** llegan una compra CLP y una compra USD para la misma tarjeta
- **THEN** cada una actualiza solo su bucket de moneda, sin conversión ni suma entre cupos

#### Scenario: Movimientos del mes no alteran snapshot actual
- **WHEN** después de validar se importan mensajes del mes con fecha anterior o igual al snapshot ingresado
- **THEN** crea las transacciones vinculadas pero no vuelve a descontarlas de los balances iniciales

#### Scenario: Reconciliación manual
- **WHEN** el usuario selecciona “Actualizar saldos” e ingresa valores actuales
- **THEN** el sistema reemplaza los buckets, guarda una nueva fecha de snapshot y proyecta solo eventos posteriores

### Requirement: Carga inicial e incremental recuperable

Al conectar Outlook, el sistema SHALL revisar el Inbox desde el primer día del mes calendario actual hasta el instante de conexión. Ese escaneo SHALL detectar candidatos sin persistir entidades financieras. Solo después de la validación SHALL crear instrumentos e importar los mensajes permitidos, conservando el estado delta de Microsoft Graph. Posteriormente SHALL procesar cambios por webhook y ejecutar delta como recuperación de notificaciones perdidas. La suscripción SHALL renovarse antes de expirar y el usuario SHALL disponer de refresco manual.

#### Scenario: Primera conexión
- **WHEN** Outlook se conecta correctamente
- **THEN** el sistema escanea el mes actual, muestra candidatos, espera validación/snapshot y recién entonces crea e importa guardando el estado delta

#### Scenario: Webhook repetido o perdido
- **WHEN** Microsoft repite una notificación o una notificación no llega
- **THEN** el reproceso no duplica movimientos y una ejecución delta posterior recupera mensajes pendientes

#### Scenario: Suscripción expirada
- **WHEN** la suscripción webhook expira o no puede renovarse
- **THEN** la conexión muestra el error, conserva su estado delta y el refresco manual puede recuperar mensajes sin duplicar

### Requirement: Webhook autenticado y acotado

El endpoint de notificaciones SHALL responder al desafío de validación de Microsoft, verificar el `clientState` de cada notificación y recuperar el mensaje autorizado desde Graph antes de procesarlo. Una notificación inválida SHALL NOT leer correo ni crear movimientos.

#### Scenario: Notificación válida
- **WHEN** Microsoft envía una notificación con `clientState` válido para una conexión activa
- **THEN** el sistema obtiene el mensaje desde Graph y aplica el filtrado de Banco de Chile

#### Scenario: Notificación falsificada
- **WHEN** una petición no supera la validación de Microsoft o presenta un `clientState` inválido
- **THEN** el sistema la rechaza sin acceder al buzón ni modificar datos financieros

### Requirement: Importación idempotente y mapeo inequívoco

El sistema SHALL importar cada correo permitido, solo después de la validación, como un movimiento confirmado y de solo lectura apuntando a la cuenta, tarjeta y bucket previamente confirmados. El movimiento entra sin categoría y luego SHALL pasar por el categorizador existente si no es interno; una falla de categorización MUST conservarlo sin categoría. Los reprocesos MUST preservar cualquier categoría asignada. El ID externo MUST ser el ID TEF cuando exista y, en su defecto, `internetMessageId` o el ID inmutable de Graph. El sistema SHALL NOT adivinar ante una colisión o ausencia de mapeo.

#### Scenario: Crear, vincular y categorizar después de validar
- **WHEN** el usuario confirma instrumentos y snapshot
- **THEN** el sistema crea las entidades, vincula cada movimiento del mes a su instrumento/bucket y categoriza los movimientos no internos

#### Scenario: Categorización falla
- **WHEN** el categorizador no puede clasificar un movimiento ya importado
- **THEN** la transacción permanece vinculada y sin categoría para revisión manual, sin revertir la importación

#### Scenario: Movimiento interno no se categoriza
- **WHEN** se importa un abono o pago marcado `isInternal`
- **THEN** actualiza la proyección aplicable pero no se envía al categorizador ni cuenta en presupuesto

#### Scenario: Mismo correo procesado dos veces
- **WHEN** la carga inicial, el webhook o delta vuelven a procesar el mismo mensaje
- **THEN** el sistema actualiza o ignora el movimiento existente por su ID externo y no crea un duplicado

#### Scenario: Mapeo ambiguo
- **WHEN** dos instrumentos comparten los últimos cuatro dígitos o el mensaje no identifica un instrumento configurado
- **THEN** el sistema omite el movimiento con un motivo visible y solicita resolver el mapeo, sin asignarlo automáticamente

### Requirement: Cobertura y estado visibles

Las cuentas conectadas por correo SHALL indicar que solo contienen movimientos notificados por email y que sus saldos/cupos son estimaciones desde el último snapshot manual, no datos actuales reportados por Banco de Chile. La UI MUST mostrar la fecha de reconciliación, última sincronización, estado de autorización y un conteo de mensajes omitidos sin información sensible.

#### Scenario: Visualización de cuenta por correo
- **WHEN** el usuario abre un banco conectado por Outlook
- **THEN** ve “Saldo estimado desde <fecha>”, la última sincronización, el estado de la conexión y la acción “Actualizar saldos”

#### Scenario: OAuth revocado
- **WHEN** Microsoft rechaza la renovación del token por autorización revocada
- **THEN** la conexión queda en `reauth_required`, conserva los movimientos existentes y pide reconectar

### Requirement: Desconexión segura

Al desconectar el método correo, el sistema SHALL eliminar la suscripción de Microsoft cuando sea posible, revocar o descartar los tokens, borrar la conexión y eliminar el banco/cuentas/movimientos asociados a ese método. La desconexión SHALL NOT afectar bancos manuales ni otros bancos del usuario. La desconexión SHALL estar disponible en todo estado de la conexión, incluida la configuración pendiente.

#### Scenario: Desconectar Outlook de Banco de Chile
- **WHEN** el usuario confirma la desconexión del método correo
- **THEN** el sistema desactiva la suscripción, elimina tokens y datos asociados a esa conexión, y permite volver a conectar después

#### Scenario: Desconectar durante la configuración pendiente
- **WHEN** el usuario desconecta una conexión autorizada que aún no confirmó candidatos ni snapshot
- **THEN** el sistema elimina la autorización y la conexión sin haber creado cuentas ni movimientos

### Requirement: El pago de tarjeta dispara las cuotas de sus planes

El evento de **pago de tarjeta de crédito** detectado en el correo SHALL disparar, además de
la proyección de saldos y cupo que ya realiza, la ejecución de la cuota correspondiente de
cada plan `card` de esa cuenta. La cuenta SHALL resolverse con el mismo mapeo de instrumento
que ya usa la proyección (últimos 4 de la tarjeta); un pago cuyo instrumento no se resuelve NO
SHALL ejecutar cuotas.

#### Scenario: Pago reconocido ejecuta las cuotas
- **WHEN** se importa un correo de pago de tarjeta de una cuenta con planes de cuotas pendientes
- **THEN** además de proyectarse el pago sobre el cupo, se ejecuta la cuota correspondiente de cada plan

#### Scenario: Pago sin instrumento resuelto no ejecuta cuotas
- **WHEN** llega un pago cuya tarjeta no puede mapearse a una cuenta del usuario
- **THEN** no se ejecuta ninguna cuota

### Requirement: El pago de cuota de crédito de consumo se engancha a su plan

El movimiento importado desde un correo de **pago de cuota de crédito de consumo** SHALL
ofrecerse a los planes `loan` de la cuenta de origen para que uno lo adopte como su cuota. El
movimiento SHALL conservarse aunque ningún plan lo reclame: sigue siendo un gasto real.

El enganche SHALL ejecutarse **antes** de la categorización por IA, igual que el match de
plantillas recurrentes: una cuota reclamada por un plan queda categorizada y revisada, y la IA
no la ve.

#### Scenario: La cuota importada se engancha al plan
- **WHEN** se importa el pago de una cuota de crédito de consumo y existe un plan `loan` de esa cuenta
- **THEN** el movimiento queda vinculado al ítem del plan, con la categoría del plan y sin pasar por IA

#### Scenario: Sin plan, la cuota sigue siendo gasto
- **WHEN** se importa el pago de una cuota y el usuario no tiene ningún plan `loan` de esa cuenta
- **THEN** el movimiento se conserva como gasto y pasa por la categorización normal

### Requirement: Un fallo en las cuotas no rompe la importación

El disparo de cuotas, en cualquiera de sus dos formas, SHALL ser best-effort respecto de la
importación: un fallo al ejecutar o enganchar cuotas NO SHALL revertir el import ni la
proyección de saldos ya aplicada.

#### Scenario: Un fallo ejecutando cuotas no rompe el import
- **WHEN** la ejecución de una cuota falla durante la importación
- **THEN** los movimientos importados y la proyección de saldos se conservan
