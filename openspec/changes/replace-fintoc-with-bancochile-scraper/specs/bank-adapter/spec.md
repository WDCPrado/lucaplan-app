## ADDED Requirements

### Requirement: Conector de banco local

El sistema SHALL definir un contrato `LocalBankConnector` que una implementación por banco cumple
para leer datos financieros **localmente**, orientado a **resultado por fuente** (cuentas, saldos,
movimientos de cuenta, movimientos de tarjeta), sin exponer detalles de transporte (HTTP, navegador)
al dominio ni a la aplicación. El contrato NO SHALL incluir semántica de proveedores remotos
(tokens persistentes, revocación de link, cursores de servidor); la sesión es **efímera** y vive
solo durante la sincronización.

#### Scenario: El dominio no conoce el transporte
- **WHEN** la aplicación sincroniza una conexión de banco
- **THEN** invoca el `LocalBankConnector` y recibe resultados normalizados por fuente, sin saber si por debajo hay un navegador, fetch o parsing

#### Scenario: Sin tokens persistentes
- **WHEN** termina una sincronización
- **THEN** no queda ningún token de acceso persistido por el contrato; la próxima sync requiere una sesión nueva

### Requirement: Ejecución local con navegador y perfil persistente

Un conector basado en navegador SHALL ejecutarse **en la máquina del usuario** con un navegador
**headful** y un **perfil persistente en disco** (para reutilizar cookies mientras la sesión siga
viva). El login lo realiza el **usuario** en la ventana (incluida MFA/2FA); el conector NO SHALL
automatizar el ingreso de contraseña ni de segundo factor, ni evadir CAPTCHA/MFA. El conector SHALL
ser de **solo lectura**: nunca inicia transferencias, pagos ni cambios en el portal.

#### Scenario: El usuario resuelve el login y el 2FA
- **WHEN** se inicia una sincronización y la sesión no está activa
- **THEN** se abre la ventana del banco y el usuario inicia sesión (con 2FA) manualmente antes de que el conector lea datos

#### Scenario: Solo lectura
- **WHEN** el conector opera sobre el portal
- **THEN** solo consulta información; no ejecuta ninguna acción que modifique el estado de la cuenta

### Requirement: Detención segura ante bloqueo

El conector SHALL **detenerse** ante señales de bloqueo o anti-automatización del portal
(`401`, `403`, `429`, expiración de sesión, challenge) reportando el motivo, sin reintentar de forma
agresiva y **sin** intentar evadir controles. Una detención SHALL dejar los datos locales previos
intactos (no los corrompe ni los borra parcialmente).

#### Scenario: Respuesta 403/429 detiene la sync
- **WHEN** el portal responde 403 o 429 durante la lectura
- **THEN** la sincronización se detiene y reporta el bloqueo, conservando los datos ya guardados

#### Scenario: Sesión expirada a mitad de sync
- **WHEN** la sesión expira mientras se leen datos
- **THEN** la sync se detiene y solicita al usuario volver a iniciar sesión, sin dejar datos a medio escribir

### Requirement: Procedimiento documentado para incorporar un banco

El repositorio SHALL incluir documentación (`docs/`) del **procedimiento para agregar un banco
nuevo** mediante **login guiado**: el usuario abre el navegador e inicia sesión mientras se
**capturan** las APIs JSON internas y sus payloads; con esos endpoints se implementa un nuevo
`LocalBankConnector`. La doc SHALL referenciar los scripts de spike como método reproducible y
advertir las reglas (solo-lectura, detención ante bloqueo, nada de credenciales fuera del proceso
local).

#### Scenario: Agregar un banco siguiendo la guía
- **WHEN** una persona quiere agregar soporte para otro banco
- **THEN** la guía la lleva a capturar los endpoints por login guiado e implementar un conector nuevo detrás del mismo contrato, sin tocar dominio ni aplicación
