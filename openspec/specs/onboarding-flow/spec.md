# onboarding-flow Specification

## Purpose
TBD - created by archiving change add-onboarding-and-incomes. Update Purpose after archive.
## Requirements
### Requirement: Onboarding fullscreen en la primera conexión de correo

El sistema SHALL mostrar un flujo de onboarding fullscreen la **primera vez** que un
usuario completa la conexión de Outlook, entendida como el retorno del callback OAuth con
`outlook=setup` mientras la conexión aún no tiene `bankId`. Una vez que la conexión tiene
`bankId`, el onboarding NO SHALL volver a mostrarse. El flujo SHALL reutilizar las
capabilities existentes (escaneo de candidatos, confirmación de snapshot, import,
categorización y triage) en vez de reimplementarlas.

#### Scenario: Primera conexión abre el onboarding

- **WHEN** el usuario vuelve del callback OAuth con `outlook=setup` y su conexión no tiene `bankId`
- **THEN** se monta el onboarding fullscreen en vez del modal de sync normal

#### Scenario: Conexión ya configurada no reabre el onboarding

- **WHEN** el usuario vuelve del callback OAuth y su conexión ya tiene `bankId`
- **THEN** no se muestra el onboarding y el sistema abre el flujo de sync/reconexión normal

### Requirement: Pasos secuenciales del onboarding

El onboarding SHALL guiar al usuario por pasos en orden: bienvenida, detección de
transacciones, confirmación de cuentas (snapshot), import, categorización conversacional
acotada, captura de ingresos y presupuesto listo. El estado del paso SHALL vivir en el
cliente; el sistema NO SHALL requerir rutas dedicadas ni persistir el paso actual. El
usuario SHALL poder avanzar y retroceder entre pasos.

#### Scenario: Avance por los pasos

- **WHEN** el usuario completa un paso y confirma
- **THEN** el onboarding avanza al siguiente paso en el orden definido

#### Scenario: Retroceso a un paso anterior

- **WHEN** el usuario retrocede desde un paso
- **THEN** el onboarding vuelve al paso anterior sin perder lo ya confirmado

### Requirement: Categorización conversacional acotada

En el paso conversacional, el onboarding SHALL presentar para triage únicamente los grupos
de comercio más frecuentes sin categoría (a lo más ~6–8 grupos), no la totalidad de los
movimientos sin categoría. Los movimientos restantes sin categoría SHALL quedar disponibles
para el triage normal del dashboard después del onboarding.

#### Scenario: Solo se preguntan los grupos más frecuentes

- **WHEN** hay 30 grupos de comercio sin categoría tras el import
- **THEN** el onboarding pide categorizar a lo más ~6–8 de los más frecuentes y deja el resto para el triage del dashboard

#### Scenario: Sin movimientos sin categoría se salta el paso

- **WHEN** tras el import no quedan movimientos sin categoría
- **THEN** el onboarding omite el paso conversacional y continúa con el paso de ingresos

### Requirement: Reanudable sin pérdida de datos

Si el usuario cierra el onboarding a medias antes del import, el sistema SHALL poder
reabrirlo desde el escaneo al volver con `outlook=setup`, sin haber persistido movimientos
parciales. El import de movimientos SHALL ocurrir de forma atómica en el paso de
confirmación; salir antes de ese paso NO SHALL dejar datos a medio importar.

#### Scenario: Cerrar antes del import no deja datos parciales

- **WHEN** el usuario cierra el onboarding durante el paso de confirmación de snapshot
- **THEN** no se importan movimientos y al volver con `outlook=setup` el onboarding reaparece desde el escaneo

