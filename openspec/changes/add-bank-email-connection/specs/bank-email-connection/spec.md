## ADDED Requirements

### Requirement: Un único método activo por banco

El sistema SHALL permitir que Banco de Chile use `scraper` o `email` como método de conexión, pero MUST mantener como máximo uno activo por usuario y banco. Para cambiar de método, el usuario MUST desconectar primero la conexión vigente. El sistema SHALL NOT combinar, conciliar ni deduplicar movimientos entre ambos métodos.

#### Scenario: Intento de conectar Outlook con scraper activo
- **WHEN** el usuario intenta conectar Outlook para Banco de Chile mientras ese banco ya está conectado por scraper
- **THEN** el sistema rechaza la conexión y solicita desconectar primero el scraper

#### Scenario: Cambio después de desconectar
- **WHEN** el usuario desconecta Banco de Chile por scraper y luego conecta Outlook
- **THEN** el sistema crea una nueva conexión Banco de Chile con método `email`, sin reutilizar ni mezclar movimientos del scraper

### Requirement: Conexión Outlook de solo lectura

El sistema SHALL conectar una cuenta Outlook personal mediante OAuth 2.0 Authorization Code con PKCE, estado verificable y el permiso delegado mínimo `Mail.Read`. El refresh token MUST permanecer cifrado en servidor y ningún token SHALL exponerse al cliente o registrarse en logs. El sistema SHALL NOT solicitar permisos para enviar, modificar o eliminar correo.

#### Scenario: Autorización exitosa
- **WHEN** el usuario autoriza `Mail.Read` y Microsoft devuelve un código válido asociado al estado iniciado por LucaPlan
- **THEN** el sistema guarda la conexión y el refresh token cifrado, sin exponerlo al navegador

#### Scenario: Callback con estado inválido
- **WHEN** el callback OAuth contiene un estado ausente, expirado o inválido
- **THEN** el sistema rechaza la conexión y no persiste tokens

### Requirement: Filtrado cerrado de notificaciones Banco de Chile

El sistema SHALL crear movimientos de gasto únicamente desde remitentes exactos de Banco de Chile y estos asuntos: `Cargo en Cuenta`, `Compra con Tarjeta de Crédito`, `Transferencia a Terceros` o el prefijo `Transferencias de Fondos a `. MAY procesar `Aviso de transferencia de fondos` y comprobantes de pago de tarjeta/línea exclusivamente como movimientos internos de balance. Todo correo que no coincida con estas reglas SHALL ser ignorado. Los cuerpos y datos personales del correo SHALL NOT persistirse una vez extraído el evento necesario.

#### Scenario: Compra con cargo en cuenta
- **WHEN** llega desde `enviodigital@bancochile.cl` un correo `Cargo en Cuenta` CLP con monto, comercio, fecha y últimos cuatro dígitos
- **THEN** el sistema genera un débito CLP candidato para la cuenta mapeada

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

#### Scenario: Compra en USD
- **WHEN** un correo permitido representa una compra USD en una tarjeta mapeada
- **THEN** crea un débito USD en `credit_international`, aumenta su usado y no mezcla el monto con presupuesto CLP

#### Scenario: Ajuste ambiguo
- **WHEN** llega una cartola, interés, ajuste o reverso sin identidad inequívoca del movimiento original
- **THEN** el sistema lo ignora y conserva la proyección hasta que el usuario reconcilie saldos

### Requirement: Configuración inicial de instrumentos y saldos

Después de autorizar Outlook, el sistema SHALL escanear desde el primer día del mes actual hasta el instante de conexión y descubrir candidatos de cuentas/tarjetas por número o últimos cuatro dígitos. Cargos nacionales CLP e internacionales USD del mismo último 4 y tipo crediticio MUST proponerse como una sola tarjeta con dos buckets, no como dos tarjetas. Antes de crear entidades financieras o transacciones, la UI SHALL mostrar los candidatos y exigir que el usuario confirme, corrija o agregue instrumentos faltantes.

Después de validar, el usuario MUST registrar un snapshot con fecha/hora: saldo propio disponible de la cuenta corriente; límite y usado de sobregiro si aplica; y, para cada tarjeta de crédito, límite y usado nacional CLP e internacional USD si aplica. El sistema SHALL calcular `available = limitAmount - used` y SHALL reutilizar los buckets `cash`, `overdraft`, `credit_national` y `credit_international` existentes.

#### Scenario: Cuenta corriente con sobregiro
- **WHEN** el usuario valida la cuenta e informa caja CLP, límite total y sobregiro usado
- **THEN** el sistema crea `cash` y `overdraft`, calcula el disponible y guarda la fecha del snapshot

#### Scenario: Cuenta corriente sin sobregiro
- **WHEN** el usuario valida la cuenta, informa su caja CLP y marca que no tiene sobregiro
- **THEN** el sistema crea `cash` sin exigir ni inventar un bucket `overdraft`

#### Scenario: Tarjeta con dos cupos
- **WHEN** los correos del mes muestran cargos CLP y USD con el mismo último 4 de tarjeta de crédito y el usuario valida el agrupamiento
- **THEN** el sistema crea una sola `Card` con `credit_national` y `credit_international`, usando cupo total/usado ingresados y sin sumar monedas

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

Al desconectar el método correo, el sistema SHALL eliminar la suscripción de Microsoft cuando sea posible, revocar o descartar los tokens, borrar la conexión y eliminar el banco/cuentas/movimientos asociados a ese método. La desconexión SHALL NOT afectar bancos manuales ni otros bancos del usuario.

#### Scenario: Desconectar Outlook de Banco de Chile
- **WHEN** el usuario confirma la desconexión del método correo
- **THEN** el sistema desactiva la suscripción, elimina tokens y datos asociados a esa conexión, y permite conectar luego el scraper
