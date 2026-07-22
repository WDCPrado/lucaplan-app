## ADDED Requirements

### Requirement: CRUD de plantillas recurrentes

El sistema SHALL exponer endpoints autenticados para listar, crear, editar, activar/desactivar
y eliminar plantillas recurrentes del usuario, con las mismas reglas de sesión y ownership
que el resto de los endpoints financieros. La creación SHALL aceptar el id de un movimiento
origen para precargar sus datos. Las validaciones de dominio (categoría obligatoria,
tolerancia válida, moneda coherente con la cuenta) SHALL responder 400 con el error de
negocio, no 500.

#### Scenario: Crear plantilla desde un movimiento
- **WHEN** el usuario crea una plantilla enviando el id de un movimiento propio
- **THEN** responde 201 con la plantilla creada, con la categoría y el monto base del movimiento

#### Scenario: Plantilla de otro usuario
- **WHEN** el usuario pide o edita una plantilla que no le pertenece
- **THEN** responde 404 sin revelar su existencia

#### Scenario: Datos inválidos
- **WHEN** se crea una plantilla sin categoría o con tolerancia negativa
- **THEN** responde 400 con el error de negocio

### Requirement: Endpoint de cron restringido a la red privada

El sistema SHALL exponer `POST /api/cron/recurring/run`, que materializa los períodos
abiertos y confirma las plantillas `cron` cuyo día corresponde, para todos los usuarios, de
forma idempotente por (plantilla, período). SHALL aceptar una fecha opcional para
reproceso y SHALL responder el conteo de movimientos materializados, confirmados y
omitidos.

Este endpoint NO SHALL usar sesión de usuario. El acceso SHALL restringirse a tráfico que
llegó por la **red privada del proyecto**: toda request que muestre señales de haber
entrado por el edge público SHALL rechazarse. Como defensa en profundidad, la request MUST
además presentar el secreto compartido del proyecto en un header; sin él SHALL rechazarse
aunque venga de la red privada. El rechazo NO SHALL revelar la existencia del endpoint ni
ejecutar efecto alguno. La verificación SHALL vivir en un guard reutilizable por todos los
`/api/cron/*`.

#### Scenario: Ejecución desde la red privada
- **WHEN** la función de cron del proyecto llama al endpoint por la red privada con el secreto correcto
- **THEN** se procesan las plantillas del día y responde el conteo de materializados, confirmados y omitidos

#### Scenario: Llamada desde internet
- **WHEN** la misma llamada llega por el edge público, aun con el secreto correcto
- **THEN** se rechaza sin ejecutar nada y sin revelar la existencia del endpoint

#### Scenario: Sin secreto
- **WHEN** la llamada llega por la red privada sin el header del secreto o con uno incorrecto
- **THEN** se rechaza sin ejecutar nada

#### Scenario: Reejecución del mismo día
- **WHEN** el endpoint se invoca dos veces el mismo día
- **THEN** la segunda no crea ni confirma movimientos adicionales y los reporta como omitidos
