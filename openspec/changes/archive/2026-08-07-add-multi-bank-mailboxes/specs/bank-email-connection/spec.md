## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Carga inicial e incremental recuperable

Al conectar un banco, el sistema SHALL revisar el Inbox del buzón desde el primer día del mes
calendario actual hasta el instante de conexión. Ese escaneo SHALL detectar candidatos sin persistir
entidades financieras. Solo después de la validación SHALL crear instrumentos e importar los mensajes
permitidos, conservando el estado delta de Microsoft Graph.

El estado delta y la suscripción SHALL ser del buzón. Cada ejecución SHALL traer los mensajes nuevos
una sola vez y repartirlos entre los vínculos del buzón según el banco al que el enrutado los
atribuya. Posteriormente SHALL procesar cambios por webhook y ejecutar delta como recuperación de
notificaciones perdidas. La suscripción SHALL renovarse antes de expirar y el usuario SHALL disponer
de refresco manual.

#### Scenario: Primera conexión
- **WHEN** un banco se conecta correctamente en un buzón autorizado
- **THEN** el sistema escanea el mes actual, muestra candidatos, espera validación/snapshot y recién entonces crea e importa guardando el estado delta del buzón

#### Scenario: Webhook repetido o perdido
- **WHEN** Microsoft repite una notificación o una notificación no llega
- **THEN** el reproceso no duplica movimientos y una ejecución delta posterior recupera mensajes pendientes

#### Scenario: Suscripción expirada
- **WHEN** la suscripción webhook expira o no puede renovarse
- **THEN** la conexión muestra el error, conserva su estado delta y el refresco manual puede recuperar mensajes sin duplicar

#### Scenario: Una pasada para varios bancos
- **WHEN** llegan mensajes de dos bancos distintos al mismo buzón
- **THEN** una sola ejecución los procesa e imputa cada movimiento al vínculo de su banco

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
- **THEN** ve “Saldo estimado desde <fecha>”, la última sincronización, el estado de la conexión y la acción “Actualizar saldos”

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
