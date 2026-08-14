# bank-email-registry

## Purpose

Catálogo de los bancos soportados por correo —clave, nombre visible, remitentes propios y parser— y
enrutado de cada mensaje al banco que lo reclama, antes de parsearlo. Es el contrato que debe cumplir
un banco nuevo para entrar sin tocar los use-cases, y lo que permite que un mismo buzón alimente
varios bancos sin que los correos de uno se cuenten como omitidos del otro.
## Requirements
### Requirement: Catálogo de bancos soportados por correo

El sistema SHALL mantener un catálogo de bancos soportados donde cada entrada declara una clave
estable (`bankKey`), el nombre visible del banco, la lista de remitentes exactos que le pertenecen y
la función que traduce un mensaje a evento financiero. La clave SHALL ser la misma que identifica al
proveedor en los datos del usuario, y el nombre visible SHALL ser el que usa la UI al crear el banco.

Los use-cases de conexión por correo SHALL obtener el parser desde el catálogo y SHALL NOT importar
el parser de un banco concreto. Agregar un banco al catálogo SHALL NOT requerir modificar los
use-cases de escaneo, confirmación ni sincronización.

#### Scenario: Un banco nuevo entra por el catálogo
- **WHEN** se agrega una entrada al catálogo con su clave, nombre, remitentes y parser
- **THEN** ese banco queda disponible para conectarse, escanearse y sincronizarse sin cambios en los use-cases

#### Scenario: Clave desconocida
- **WHEN** una operación pide el parser de una clave que no está en el catálogo
- **THEN** el sistema falla de forma explícita y no procesa correo alguno con un parser ajeno

### Requirement: Enrutado de mensajes por remitente

El sistema SHALL determinar a qué banco pertenece un mensaje comparando su remitente contra los
remitentes declarados en el catálogo, ANTES de parsear el contenido. Un mensaje cuyo remitente no
pertenezca a ningún banco del catálogo SHALL NOT parsearse. Un remitente SHALL pertenecer como
máximo a un banco del catálogo.

Cuando un banco distinga variantes de la misma institución (por ejemplo, avisos de una cuenta
empresa), esas variantes SHALL declararse como remitentes adicionales de la MISMA clave, y SHALL NOT
crear una clave nueva: el efecto financiero es idéntico.

#### Scenario: Correo de un banco del catálogo
- **WHEN** llega un mensaje cuyo remitente está declarado por un banco del catálogo
- **THEN** el sistema lo entrega al parser de ese banco y a ningún otro

#### Scenario: Correo ajeno al catálogo
- **WHEN** llega un mensaje cuyo remitente no pertenece a ningún banco del catálogo
- **THEN** el sistema no lo parsea y no crea ni modifica movimientos

### Requirement: El contrato del parser es común a todos los bancos

Todo parser del catálogo SHALL recibir un mensaje de correo y devolver un evento financiero válido o
un motivo de omisión, con el mismo tipo de resultado para todos los bancos. Ningún parser SHALL
producir un evento de ingreso: del correo solo salen gasto y ajuste de saldo interno.

El instrumento del evento SHALL expresarse en una de tres formas: cuenta corriente por número o
últimos 4, tarjeta de crédito por últimos 4, o **la cuenta principal del vínculo**, sin número.
Esta última existe porque hay bancos cuyas plantillas nombran la cuenta de cargo solo como "tu
cuenta principal": el parser SHALL usarla en vez de inventar un número o de omitir el movimiento, y
la resolución contra los instrumentos confirmados SHALL ocurrir fuera del parser.

#### Scenario: Resultado uniforme
- **WHEN** cualquier parser del catálogo procesa un mensaje
- **THEN** devuelve un evento financiero o un motivo de omisión, sin efectos secundarios ni persistencia

#### Scenario: Ningún banco puede crear un ingreso
- **WHEN** un parser encuentra una entrada de dinero (abono, devolución, reembolso)
- **THEN** la clasifica como ajuste de saldo interno y nunca como ingreso del mes

#### Scenario: La plantilla no numera la cuenta de cargo
- **WHEN** un parser reconoce un cargo cuya plantilla identifica el origen solo como la cuenta principal del banco
- **THEN** emite el evento con la referencia a cuenta principal, sin número de cuenta inventado ni últimos 4 tomados de otro dato del correo

