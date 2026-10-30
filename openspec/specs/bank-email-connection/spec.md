# bank-email-connection

## Purpose

Conexión bancaria por notificaciones de correo: OAuth de Outlook (Microsoft Graph, permiso mínimo
`Mail.Read`), exclusividad del método de conexión por banco, filtrado fail-closed de notificaciones
de Banco de Chile, carga inicial del mes y sincronización incremental (webhook + delta), snapshot
manual de saldos con proyección estimada, e importación idempotente con categorización IA. Los
saldos resultantes son proyecciones desde el último snapshot, nunca saldos reportados por el banco.
## Requirements
### Requirement: Un único método activo por banco

El sistema SHALL permitir que un banco use `email` como método de conexión y MUST mantener como
máximo un método activo por usuario, banco y buzón de origen. Un mismo banco MAY estar conectado
desde buzones distintos; SHALL NOT estarlo por dos métodos distintos desde el mismo origen. Para
cambiar o rehacer la conexión de un vínculo, el usuario MUST desconectar primero la vigente. El
sistema SHALL NOT combinar, conciliar ni deduplicar movimientos entre métodos de conexión distintos
ni entre vínculos distintos del mismo banco.

#### Scenario: Intento de conectar con otro método activo
- **WHEN** el usuario intenta conectar Outlook para un banco que ya tiene otro método de conexión activo desde ese mismo origen
- **THEN** el sistema rechaza la conexión y solicita desconectar primero el método vigente

#### Scenario: Cambio después de desconectar
- **WHEN** el usuario desconecta un banco y luego lo conecta por correo
- **THEN** el sistema crea un vínculo nuevo con método `email`, sin reutilizar ni mezclar movimientos anteriores

#### Scenario: Mismo banco desde otro buzón
- **WHEN** el usuario conecta el mismo banco desde un segundo buzón autorizado
- **THEN** el sistema lo permite y mantiene ambos vínculos activos e independientes

### Requirement: Conexión Outlook de solo lectura

El sistema SHALL conectar una cuenta Outlook personal mediante OAuth 2.0 Authorization Code con
PKCE, estado verificable y el permiso delegado mínimo `Mail.Read`. El refresh token MUST permanecer
cifrado en servidor, MUST guardarse una sola vez por buzón —nunca una copia por banco— y ningún
token SHALL exponerse al cliente o registrarse en logs. El sistema SHALL NOT solicitar permisos para
enviar, modificar o eliminar correo.

La autorización pertenece al buzón y SHALL servir a todos los bancos que ese buzón alimente. Su
pérdida o revocación SHALL afectar por igual a todos ellos, y una sola reconexión SHALL restablecerlos.

#### Scenario: Autorización exitosa
- **WHEN** el usuario autoriza `Mail.Read` y Microsoft devuelve un código válido asociado al estado iniciado por LucaPlan
- **THEN** el sistema guarda el buzón y el refresh token cifrado, sin exponerlo al navegador

#### Scenario: Callback con estado inválido
- **WHEN** el callback OAuth contiene un estado ausente, expirado o inválido
- **THEN** el sistema rechaza la conexión y no persiste tokens

#### Scenario: Reautorización de un buzón con varios bancos
- **WHEN** un buzón que alimenta varios bancos queda en `reauth_required` y el usuario reconecta
- **THEN** una sola autorización restablece la sincronización de todos sus bancos

### Requirement: Filtrado cerrado de notificaciones Banco de Chile

El sistema SHALL crear movimientos de gasto únicamente desde remitentes exactos de Banco de Chile y estos asuntos: `Cargo en Cuenta`, `Compra con Tarjeta de Crédito`, `Transferencia a Terceros` o el prefijo `Transferencias de Fondos a `. El asunto `Comprobante Pago Credito Consumo` SHALL producir un gasto CLP. El sistema SHALL reconocer desde `serviciodetransferencias@bancochile.cl` los asuntos `Pago de Tarjeta de Crédito Nacional` y `Pago de Tarjeta de Crédito Internacional` (normalizados, y con validación secundaria del cuerpo `se ha efectuado el pago de la tarjeta de crédito`) y procesarlos exclusivamente como pago interno de tarjeta (ver "Pago de tarjeta de crédito con dos patas"). MAY procesar `Aviso de transferencia de fondos` y comprobantes de pago de línea exclusivamente como movimientos internos de balance. Todo correo que no coincida con estas reglas SHALL ser ignorado. Los cuerpos y datos personales del correo SHALL NOT persistirse una vez extraído el evento necesario. Cuando una plantilla permitida incluya comercio o destinatario, el sistema MUST usar ese detalle como descripción del movimiento y SHALL NOT sustituirlo por el asunto genérico del correo.

#### Scenario: Compra con cargo en cuenta
- **WHEN** llega desde `enviodigital@bancochile.cl` un correo `Cargo en Cuenta` con la frase `compra por <monto> con cargo a Cuenta <cuenta> en <comercio> el <fecha>`
- **THEN** el sistema genera un débito CLP para la cuenta mapeada y usa `<comercio>` como descripción antes de categorizar

#### Scenario: Transferencia saliente
- **WHEN** llega desde `serviciodetransferencias@bancochile.cl` una `Transferencia a Terceros` o `Transferencias de Fondos a <comercio>` CLP con ID TEF
- **THEN** el sistema genera un débito CLP con ese ID TEF como identidad bancaria estable

#### Scenario: Remitente o asunto desconocido
- **WHEN** llega un correo cuyo remitente o asunto no coincide exactamente con la allowlist
- **THEN** el sistema lo ignora sin crear una transacción

### Requirement: Operaciones internas fuera del presupuesto

El sistema MUST excluir del ingreso, gasto categorizable y presupuesto los pagos de
tarjeta/línea/crédito, y SHALL descartar por completo los avisos de dinero entrante (abonos y
transferencias recibidas) sin crear movimiento alguno. Cuando el correo de un pago interno
identifique inequívocamente monto, moneda e instrumento, el sistema MAY conservarlo como movimiento
`isInternal` para actualizar una proyección de balance. Cartolas, intereses y ajustes/reversos
ambiguos SHALL ser ignorados.

El descarte de los abonos SHALL usar un motivo propio, distinto del de un correo que no pudo
procesarse: no es un fallo, es una decisión. El correo de una transferencia recibida es idéntico
venga de un sueldo o de una devolución entre amigos, y crear el movimiento obligaría a decidir cuál
es sin datos para hacerlo. El dinero que entra se declara en el módulo de Ingresos, que además ya
mueve el saldo: procesarlo también desde el correo lo sumaría dos veces.

#### Scenario: Abono recibido
- **WHEN** llega `Aviso de transferencia de fondos`, `Notificación de abono` o un equivalente que representa dinero transferido al usuario
- **THEN** el sistema lo descarta con el motivo `abono_ignorado`, sin crear movimiento ni mover saldo, y sin contarlo como omisión por plantilla rota

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

Después de autorizar Outlook, el sistema SHALL escanear el mes de la **última notificación de ese
banco que produzca un movimiento reconocible**, hasta el instante de conexión, y descubrir candidatos
de cuentas/tarjetas por número o últimos cuatro dígitos. Si el mes de la última notificación no
produce ningún movimiento —porque esos correos son promociones, avisos de dinero entrante o
plantillas que el parser no reconoce— el sistema SHALL seguir buscando hacia atrás, mes a mes con
actividad de ese banco, hasta encontrar uno que sí los produzca. La búsqueda SHALL acotarse a un
máximo declarado de meses hacia atrás y SHALL NOT descargar los cuerpos de los correos para ubicar
cada mes candidato.

Si ningún mes del plazo produce movimientos, la ventana SHALL ser la del mes más reciente que sí
tenga correos de ese banco —así el usuario ve por qué se omitieron— y, si no hay ninguno, el mes en
curso. El escaneo y la confirmación posterior SHALL usar exactamente la misma ventana.

Cargos nacionales CLP e internacionales USD del mismo último 4 y tipo crediticio MUST proponerse como
una sola tarjeta con dos buckets, no como dos tarjetas. Antes de crear entidades financieras o
transacciones, la UI SHALL mostrar los candidatos y exigir que el usuario confirme, corrija o agregue
instrumentos faltantes.

Después de validar, el usuario MUST registrar un snapshot con fecha/hora: saldo propio disponible de la cuenta corriente; límite y disponible de sobregiro si aplica; y, para cada tarjeta de crédito, límite y disponible nacional CLP e internacional USD si aplica. El sistema SHALL validar `0 <= available <= limitAmount`, calcular `used = limitAmount - available` y SHALL reutilizar los buckets `cash`, `overdraft`, `credit_national` y `credit_international` existentes.

#### Scenario: El banco no tuvo movimientos este mes
- **WHEN** el usuario conecta un banco cuya última notificación en el buzón es de un mes anterior, dentro del plazo máximo de búsqueda
- **THEN** el escaneo usa el mes de esa notificación y propone los instrumentos que esos avisos identifiquen por número o últimos 4, en vez de terminar sin mirar nada
- **AND** si los avisos de esa ventana solo refieren a la cuenta principal, sin número, el escaneo los procesa y cuenta pero la cuenta la agrega el usuario antes de confirmar

#### Scenario: Un correo llegado después del OAuth no mueve la ventana
- **WHEN** entra una notificación de ese banco entre la creación del vínculo y el escaneo (o entre el escaneo y la confirmación)
- **THEN** la ventana sigue siendo la del último aviso anterior al instante del vínculo, y escaneo y confirmación recorren el mismo rango

#### Scenario: El último correo del banco no es un movimiento
- **WHEN** el mes de la última notificación solo trae promociones, avisos de dinero entrante o plantillas no reconocidas
- **THEN** el sistema descarta esa ventana y sigue hacia atrás hasta el primer mes que produzca movimientos, dentro del plazo máximo

#### Scenario: El banco no tiene notificaciones útiles en el plazo máximo
- **WHEN** el buzón no tiene ningún correo de ese banco —o ninguno que produzca movimientos— dentro del plazo de búsqueda hacia atrás
- **THEN** el escaneo termina sin candidatos, informando los motivos de omisión de los correos que sí encontró, y el usuario puede agregar sus instrumentos a mano antes de confirmar

#### Scenario: La confirmación importa lo mismo que se revisó
- **WHEN** el usuario confirma los instrumentos y el snapshot después de un escaneo cuya ventana no es el mes en curso
- **THEN** la importación inicial recorre esa misma ventana, sin ampliarla ni reducirla

#### Scenario: Cuenta corriente con sobregiro
- **WHEN** el usuario valida la cuenta e informa caja CLP, límite total y sobregiro disponible
- **THEN** el sistema crea `cash` y `overdraft`, deriva el usado y guarda la fecha del snapshot

#### Scenario: Cuenta corriente sin sobregiro
- **WHEN** el usuario valida la cuenta, informa su caja CLP y marca que no tiene sobregiro
- **THEN** el sistema crea `cash` sin exigir ni inventar un bucket `overdraft`

#### Scenario: Tarjeta con dos cupos
- **WHEN** los correos de la ventana escaneada muestran cargos CLP y USD con el mismo último 4 de tarjeta de crédito y el usuario valida el agrupamiento
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

#### Scenario: Tarjeta sin movimientos en la ventana escaneada
- **WHEN** una tarjeta real no aparece entre los candidatos porque no tuvo notificaciones en esa ventana
- **THEN** el usuario puede agregarla y definir sus cupos antes de confirmar

#### Scenario: Instrumento sin saldo confirmado
- **WHEN** el escaneo descubre una cuenta o tarjeta pero el usuario no confirma su mapeo y snapshot
- **THEN** el sistema no crea ni importa ese instrumento

### Requirement: Proyección y reconciliación de balances

Solo los eventos posteriores al snapshot vigente SHALL actualizar balances estimados. Un débito CLP MUST consumir primero caja y luego aumentar sobregiro usado; un abono interno MUST reducir primero sobregiro usado y después aumentar caja. Una compra de crédito MUST aumentar `used` y reducir `available` del cupo de su moneda; un pago interno inequívoco MUST reducir `used` sin dejarlo bajo cero. El usuario SHALL poder reemplazar los valores estimados desde el plugin MCP (`lucaplan_reconciliar_saldos_correo` para un banco conectado por correo, `lucaplan_actualizar_saldos` para una cuenta), creando un nuevo snapshot. La app no ofrece esa acción en su UI.

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
- **WHEN** el usuario ingresa los valores actuales con la herramienta `lucaplan_reconciliar_saldos_correo` del plugin MCP
- **THEN** el sistema reemplaza los buckets, guarda una nueva fecha de snapshot y proyecta solo eventos posteriores

### Requirement: Carga inicial e incremental recuperable

Al conectar un banco, el sistema SHALL revisar el Inbox del buzón en el mes de la última notificación
de ese banco que produzca movimientos, buscándola hacia atrás hasta un máximo declarado de meses, y
sin pasar del instante de conexión. Si ningún mes del plazo produce movimientos, SHALL revisar el más
reciente con correos suyos; sin ninguno, el mes calendario del instante de conexión. Ese escaneo SHALL detectar candidatos sin persistir entidades financieras.
Solo después de la validación SHALL crear instrumentos e importar los mensajes permitidos,
conservando el estado delta de Microsoft Graph.

El estado delta y la suscripción SHALL ser del buzón, y SHALL arrancar en la confirmación con
independencia de qué mes se haya escaneado. Cada ejecución SHALL traer los mensajes nuevos una sola
vez y repartirlos entre los vínculos del buzón según el banco al que el enrutado los atribuya.
Posteriormente SHALL procesar cambios por webhook y ejecutar delta como recuperación de
notificaciones perdidas. La suscripción SHALL renovarse antes de expirar y el usuario SHALL disponer
de refresco manual.

#### Scenario: Primera conexión
- **WHEN** un banco se conecta correctamente en un buzón autorizado
- **THEN** el sistema escanea el mes de su última notificación, muestra candidatos, espera validación/snapshot y recién entonces crea e importa guardando el estado delta del buzón

#### Scenario: Webhook repetido o perdido
- **WHEN** Microsoft repite una notificación o una notificación no llega
- **THEN** el reproceso no duplica movimientos y una ejecución delta posterior recupera mensajes pendientes

#### Scenario: Suscripción expirada
- **WHEN** la suscripción webhook expira o no puede renovarse
- **THEN** la conexión muestra el error, conserva su estado delta y el refresco manual puede recuperar mensajes sin duplicar

#### Scenario: Una pasada para varios bancos
- **WHEN** llegan mensajes de dos bancos distintos al mismo buzón
- **THEN** una sola ejecución los procesa e imputa cada movimiento al vínculo de su banco

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

Las cuentas conectadas por correo SHALL indicar que solo contienen movimientos notificados por email
y que sus saldos/cupos son estimaciones desde el último snapshot manual, no datos actuales reportados
por el banco. La UI MUST mostrar la fecha de reconciliación, última sincronización, estado de
autorización y un conteo de mensajes omitidos sin información sensible.

La UI MUST presentar la conexión en dos niveles: los buzones conectados y, dentro de cada uno, sus
bancos. El estado de autorización SHALL mostrarse en el buzón, y sus bancos SHALL reflejarlo. La
fecha de reconciliación, la etiqueta y el conteo de omitidos SHALL mostrarse por banco.

#### Scenario: Visualización de cuenta por correo
- **WHEN** el usuario abre un banco conectado por Outlook
- **THEN** ve “Saldo estimado desde <fecha>”, la última sincronización y el estado de la conexión, sin una acción para actualizar saldos (eso se hace por el plugin MCP)

#### Scenario: OAuth revocado
- **WHEN** Microsoft rechaza la renovación del token por autorización revocada
- **THEN** el buzón queda en `reauth_required`, todos sus bancos conservan los movimientos existentes y la UI pide reconectar una sola vez

#### Scenario: Dos vínculos del mismo banco
- **WHEN** el usuario tiene el mismo banco conectado desde dos buzones
- **THEN** la UI los muestra con su etiqueta como badge y cada uno con su propio correo de origen, snapshot y conteo de omitidos

### Requirement: Desconexión segura

Al desconectar un banco, el sistema SHALL eliminar ese vínculo junto con el banco, cuentas y
movimientos asociados, y SHALL conservar intactos los demás bancos del mismo buzón, los bancos
manuales y los conectados desde otros buzones. Cuando se elimina el último vínculo de un buzón, el
sistema SHALL eliminar la suscripción de Microsoft cuando sea posible, revocar o descartar los
tokens y borrar el buzón.

El usuario SHALL poder además desconectar un buzón completo, lo que equivale a desconectar todos sus
bancos. La desconexión SHALL estar disponible en todo estado, incluida la configuración pendiente.

Antes de ejecutar, el sistema MUST informar qué se pierde: además de las cuentas y sus movimientos,
las fuentes de ingreso, plantillas recurrentes y planes de cuotas que el usuario creó sobre esas
cuentas se eliminan con ellas. La UI SHALL mostrar ese detalle con sus conteos y exigir una
confirmación explícita; SHALL NOT borrarlos en silencio.

#### Scenario: Desconectar un banco de un buzón con varios
- **WHEN** el usuario desconecta uno de los bancos de un buzón que alimenta dos
- **THEN** el sistema elimina ese banco y sus datos, conserva el otro y mantiene viva la suscripción del buzón

#### Scenario: Desconectar el último banco del buzón
- **WHEN** el usuario desconecta el único banco que quedaba en un buzón
- **THEN** el sistema desactiva la suscripción, elimina los tokens y borra el buzón

#### Scenario: Desconectar durante la configuración pendiente
- **WHEN** el usuario desconecta un vínculo autorizado que aún no confirmó candidatos ni snapshot
- **THEN** el sistema elimina el vínculo sin haber creado cuentas ni movimientos, y el buzón sobrevive si tiene otros bancos

#### Scenario: Aviso de lo que arrastra la desconexión
- **WHEN** el usuario pide desconectar un banco cuyas cuentas tienen recurrentes, planes de cuotas o fuentes de ingreso asociadas
- **THEN** la UI enumera cuántos de esos elementos se eliminarán junto con las cuentas y exige confirmación explícita antes de ejecutar

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

### Requirement: Pago de tarjeta de crédito con dos patas

El sistema SHALL procesar los comprobantes con asunto `Pago de Tarjeta de Crédito Nacional` e `Internacional` (remitente `serviciodetransferencias@bancochile.cl`) como un **pago interno de dos patas**, ambas marcadas `isInternal`, visibles en el historial pero excluidas de ingreso, gasto categorizable, presupuesto y categorización por IA:

- **Pata de caja:** un débito que reduce la caja de la **cuenta corriente de origen** (sección "Origen") por el monto pagado en CLP.
- **Pata de deuda:** un crédito interno que reduce el `Utilizado` de la **tarjeta de destino** (sección "Destino", por últimos 4) en el bucket de su moneda —`credit_national` para el nacional, `credit_international` para el internacional— liberando cupo.

El monto pagado SHALL leerse por **etiqueta** (`Monto` en el nacional; `Monto pagado` en USD para la deuda y `Monto` en CLP para la caja en el internacional) y NUNCA desde la etiqueta `Utilizado`, que es la deuda previa. En el internacional cada pata SHALL usar su propia moneda y el sistema SHALL NOT recalcular el tipo de cambio informado por el banco. El sistema SHALL NOT persistir ni registrar el número completo de la tarjeta ni de la cuenta.

Cada pata SHALL tener una identidad idempotente propia y estable, derivada del campo `Transacción` del correo (con Message-ID de fallback) sufijada por pata, de modo que reprocesar el mismo correo no duplique ninguno de los dos movimientos. Si falta el monto pagado, la cuenta de origen o la tarjeta de destino en los instrumentos confirmados, el sistema SHALL omitir el correo **completo** (fail-closed), sin registrar medio pago.

#### Scenario: Pago de tarjeta nacional descuenta caja y libera cupo
- **WHEN** llega el asunto `Pago de Tarjeta de Crédito Nacional` con `Utilizado $540.835` y `Monto $652.580`, cuenta de origen en "Origen" y `N° de tarjeta ************2120`
- **THEN** el sistema registra un débito interno de $652.580 en la caja de la cuenta corriente y un crédito interno de $652.580 en el bucket `credit_national` de la tarjeta ••••2120, tomando el `Monto` y nunca el `Utilizado`
- **AND** ninguno de los dos cuenta como gasto, ingreso ni presupuesto, ni se envía al categorizador de IA

#### Scenario: Mismo remitente, otro comprobante, no es pago de tarjeta
- **WHEN** llega desde `serviciodetransferencias@bancochile.cl` una `Transferencia a Terceros` o un pago de línea de crédito
- **THEN** el sistema NO lo procesa como pago de tarjeta; la detección exige el asunto exacto de pago de tarjeta y su validación de cuerpo

#### Scenario: Pago de tarjeta internacional es bimoneda
- **WHEN** llega `Comprobante pago Tarjeta de Crédito Internacional` con `Monto pagado USD$142,05`, `Tipo de cambio $947` y `Monto $134.571`
- **THEN** la pata de deuda reduce el bucket `credit_international` de la tarjeta en USD$142,05 y la pata de caja reduce la cuenta corriente en $134.571 CLP, sin recalcular el tipo de cambio

#### Scenario: Reprocesar el correo no duplica ninguna pata
- **WHEN** el webhook o el delta vuelven a entregar el mismo comprobante de pago de tarjeta
- **THEN** las dos patas se reconocen por su identidad sufijada y no se crean movimientos ni proyecciones duplicados

#### Scenario: Instrumento faltante omite el pago completo
- **WHEN** el comprobante identifica la tarjeta pero su cuenta corriente de origen (o la tarjeta) no está entre los instrumentos confirmados
- **THEN** el sistema omite el correo completo sin registrar ninguna de las dos patas

### Requirement: Un buzón alimenta varios bancos

Un buzón autorizado SHALL poder alimentar varios bancos a la vez. Agregar un banco a un buzón ya
autorizado SHALL NOT requerir una nueva autorización de Microsoft: el sistema SHALL reutilizar la
autorización vigente del buzón. Cada banco agregado SHALL pasar por su propio escaneo, validación de
instrumentos y snapshot antes de crear entidades financieras.

El buzón SHALL mantener una sola autorización, un solo estado delta y una sola suscripción webhook,
independientemente de cuántos bancos alimente.

#### Scenario: Segundo banco en un buzón conectado
- **WHEN** el usuario agrega un segundo banco a un buzón ya autorizado
- **THEN** el sistema inicia el escaneo de ese banco sin pedir otra autorización de Microsoft

#### Scenario: Una sola suscripción por buzón
- **WHEN** un buzón alimenta dos o más bancos
- **THEN** el sistema mantiene una única suscripción webhook y un único estado delta para ese buzón, y procesa cada mensaje entrante una sola vez

### Requirement: Un banco puede venir de varios buzones

El mismo banco SHALL poder conectarse desde buzones distintos (por ejemplo, una cuenta personal y
una de empresa). Cada combinación de banco y buzón SHALL crear su propio banco en los datos del
usuario, con sus propias cuentas, snapshot y movimientos, y SHALL NOT fusionarse con el otro.

Cuando el usuario conecta un banco que ya está conectado desde otro buzón, el sistema MUST exigir
una etiqueta corta que lo distinga. La etiqueta SHALL ser opcional cuando es el primer vínculo de ese
banco. El sistema SHALL NOT inferir la etiqueta del contenido del correo ni del proveedor: es una
elección del usuario.

El nombre visible del banco SHALL componerse del nombre del catálogo más su etiqueta, y la etiqueta
SHALL mostrarse como badge en las superficies donde el banco aparece junto a otros.

#### Scenario: Mismo banco en un segundo correo
- **WHEN** el usuario conecta Banco de Chile desde un segundo buzón e indica la etiqueta "Empresa"
- **THEN** el sistema crea un banco independiente llamado "Banco de Chile Empresa", con sus propias cuentas y snapshot, sin tocar el existente

#### Scenario: Etiqueta obligatoria a partir del segundo vínculo
- **WHEN** el usuario intenta conectar un banco que ya tiene un vínculo y no indica etiqueta
- **THEN** el sistema rechaza la operación y solicita una etiqueta que lo distinga

#### Scenario: El parser no cambia con la etiqueta
- **WHEN** llega un correo a cualquiera de los dos vínculos del mismo banco
- **THEN** se aplica exactamente la misma allowlist y el mismo parser, y solo cambia el banco al que se imputa el movimiento

### Requirement: Un banco no se repite dentro del mismo buzón

El sistema SHALL rechazar conectar un banco que ya tiene un vínculo en ese mismo buzón. Dos vínculos
del mismo proveedor en un buzón harían ambiguo el enrutado: ambos declaran los mismos remitentes y no
existe forma de decidir a cuál imputar el movimiento sin adivinar. Repetir un banco SHALL exigir otro
buzón.

#### Scenario: Banco ya vinculado a ese buzón
- **WHEN** el usuario intenta agregar un banco que ese buzón ya alimenta
- **THEN** el sistema rechaza la operación y explica que ese banco ya está conectado desde ese correo

#### Scenario: El mismo banco desde otro buzón sí se permite
- **WHEN** el usuario conecta ese mismo banco desde un buzón distinto
- **THEN** el sistema lo acepta, porque cada buzón trae sus propios correos y el enrutado no es ambiguo

### Requirement: Ciclo de vida por vínculo banco-buzón

Cada operación de configuración SHALL ejecutarse sobre un vínculo banco-buzón concreto, no sobre el
usuario: el escaneo de candidatos, la confirmación de instrumentos y snapshot, la reconciliación
manual de saldos y el conteo de mensajes omitidos. Una operación sobre un vínculo SHALL NOT alterar
los instrumentos, saldos ni estado de setup de otro vínculo, aunque compartan buzón o proveedor.

El escaneo de un vínculo SHALL considerar únicamente los mensajes que el enrutado atribuye a su
banco.

#### Scenario: Escaneo acotado al banco del vínculo
- **WHEN** se escanea un vínculo en un buzón que también recibe correos de otro banco
- **THEN** los candidatos detectados provienen solo de los correos de su banco

#### Scenario: Confirmación aislada
- **WHEN** el usuario confirma instrumentos y snapshot de un vínculo
- **THEN** se crean únicamente las cuentas, tarjetas, buckets y movimientos de ese vínculo, y los demás vínculos quedan intactos

### Requirement: Los correos de otro banco no cuentan como omitidos

El conteo de mensajes omitidos de un vínculo SHALL contabilizar únicamente los correos atribuidos a
su banco que no pudieron convertirse en movimiento (sin monto, sin instrumento, asunto no catalogado
o plantilla desconocida). Un correo atribuido a otro banco del mismo buzón SHALL NOT incrementarlo.

Los correos que no pertenecen a ningún banco del catálogo SHALL contabilizarse en el buzón, no en un
banco.

#### Scenario: Correo del otro banco del mismo buzón
- **WHEN** llega al buzón un correo de un banco distinto al del vínculo
- **THEN** el vínculo no incrementa su conteo de omitidos y el correo se procesa en el vínculo que le corresponde

#### Scenario: Correo ajeno a todos los bancos
- **WHEN** llega al buzón un correo que ningún banco del catálogo reclama
- **THEN** el sistema lo cuenta como mensaje descartado del buzón, sin atribuirlo a ningún banco

### Requirement: Migración sin reconexión

Las conexiones existentes SHALL convertirse en un buzón con un vínculo a su banco conservando
autorización, estado delta, suscripción, snapshot vigente, instrumentos y movimientos. El usuario
SHALL NOT tener que reautorizar Microsoft, reingresar saldos ni volver a validar instrumentos, y la
sincronización posterior SHALL NOT duplicar movimientos ya importados.

#### Scenario: Conexión existente tras la migración
- **WHEN** un usuario con una conexión previa abre la app después de la migración
- **THEN** ve su banco conectado con su snapshot y movimientos intactos, y el refresco manual sincroniza sin pedir reautorización

#### Scenario: Sin duplicados tras migrar
- **WHEN** se sincroniza por primera vez después de la migración
- **THEN** los movimientos ya importados se reconocen por su identidad y no se crean duplicados

### Requirement: Filtrado cerrado de notificaciones MACHBANK (solo débito)

El sistema SHALL crear movimientos desde MACHBANK únicamente con los remitentes exactos
`no-reply@mail.machbank.cl`, `contacto@mail.machbank.cl` y `noreply@somosmach.com`, y solo con estas
plantillas:

- el prefijo de asunto `Realizaste una transferencia a `, cuando el cuerpo confirme además que la
  transferencia salió de la cuenta principal MACHBANK → **gasto CLP** desde la cuenta principal, con
  el `Código de confirmación` como identidad bancaria estable;
- el asunto `Tu compra con MACHBANK` (con o sin emoji), cuando el cuerpo declare `Tarjeta Visa
  Débito` → **gasto CLP** en la cuenta corriente de esa tarjeta, por el valor de la etiqueta `Monto
  CLP` y con el `Identificador Visa` como identidad bancaria estable;
- el prefijo de asunto `Le pagaste a `, cuando el cuerpo confirme `Le pagaste <monto> a
  <destinatario>` → **gasto CLP** desde la cuenta principal.

El asunto `Recibiste una transferencia de ` SHALL descartarse con el motivo `abono_ignorado`. Todo
otro correo de esos remitentes —incluidas las promociones que salen de `contacto@mail.machbank.cl`—
SHALL ignorarse sin crear movimiento.

El monto de una compra internacional SHALL ser el `Monto CLP` cobrado; el monto en moneda original
es informativo y SHALL NOT convertirse en un cargo USD ni en un cupo internacional. Ninguna
plantilla MACHBANK SHALL producir un evento de tarjeta de crédito, cupo nacional o internacional,
cuota, pago de tarjeta o sobregiro: el escaneo SHALL proponer únicamente la cuenta corriente y el
único bucket que nace del adapter SHALL ser `cash`.

Del correo SHALL extraerse solo lo necesario para el movimiento. El RUT, el banco y la cuenta de
destino del destinatario SHALL NOT persistirse ni aparecer en la descripción.

#### Scenario: Transferencia saliente
- **WHEN** llega desde `no-reply@mail.machbank.cl` un asunto `Realizaste una transferencia a <destinatario>` cuyo cuerpo confirma la salida desde la cuenta principal MACHBANK
- **THEN** el sistema genera un gasto CLP desde la cuenta principal, descrito con el nombre del destinatario y con el código de confirmación como identidad estable, sin persistir su RUT ni su cuenta

#### Scenario: Compra con Visa Débito en dólares
- **WHEN** llega desde `contacto@mail.machbank.cl` una compra con `Tarjeta Visa Débito` que informa `Monto (moneda original) $ 1 USD` y `Monto CLP $ 943`
- **THEN** el sistema genera un gasto de 943 CLP en la cuenta corriente cuya tarjeta termina en esos últimos 4, y no crea cargo USD ni bucket internacional

#### Scenario: Pago directo
- **WHEN** llega desde `contacto@mail.machbank.cl` un asunto `Le pagaste a <destinatario>` cuyo cuerpo confirma `Le pagaste <monto> a <destinatario>`
- **THEN** el sistema genera un gasto CLP desde la cuenta principal con el destinatario como descripción, usando la fecha de recepción y la identidad de correo cuando la plantilla no trae fecha ni ID propio

#### Scenario: Transferencia recibida
- **WHEN** llega desde `noreply@somosmach.com` un asunto `Recibiste una transferencia de <remitente>`
- **THEN** el sistema lo descarta con el motivo `abono_ignorado`, sin crear ingreso ni gasto y sin mover la proyección de saldo

#### Scenario: Promoción desde un remitente compartido
- **WHEN** llega desde `contacto@mail.machbank.cl` un correo de marketing o cualquier asunto fuera de la allowlist
- **THEN** el sistema no crea movimiento alguno

### Requirement: La cuenta principal se resuelve solo si es inequívoca

El sistema SHALL resolver la referencia a la cuenta principal del vínculo contra la cuenta corriente
confirmada de ese vínculo únicamente si existe exactamente una. Con cero o más de una, el movimiento
SHALL omitirse y SHALL sumar al contador de omitidos del vínculo —el mismo que ya muestra el estado
de la conexión—, y el sistema SHALL NOT elegir una cuenta arbitrariamente ni inventar un número.

El gasto así resuelto SHALL descontar la caja de esa cuenta como cualquier otro cargo en cuenta
corriente.

#### Scenario: Una sola cuenta corriente confirmada
- **WHEN** se importa un evento con referencia a la cuenta principal y el vínculo tiene exactamente una cuenta corriente confirmada
- **THEN** el movimiento se vincula a esa cuenta y su bucket `cash`, y la proyección descuenta el monto

#### Scenario: Ninguna o varias cuentas corrientes
- **WHEN** se importa un evento con referencia a la cuenta principal y el vínculo tiene cero o más de una cuenta corriente confirmada
- **THEN** el sistema omite el movimiento y lo suma al contador de omitidos del vínculo, sin asignarlo a ninguna cuenta

#### Scenario: Escaneo inicial
- **WHEN** el escaneo del mes encuentra eventos que solo refieren a la cuenta principal
- **THEN** no propone un candidato de cuenta con un número inventado; la cuenta se propone desde los correos que sí identifican el instrumento, o la agrega el usuario

