## MODIFIED Requirements

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
