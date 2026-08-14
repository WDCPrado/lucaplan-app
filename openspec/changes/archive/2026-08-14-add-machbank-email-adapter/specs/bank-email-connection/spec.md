## ADDED Requirements

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
