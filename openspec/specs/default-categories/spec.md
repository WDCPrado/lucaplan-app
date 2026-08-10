# default-categories Specification

## Purpose
Con qué categorías parte una cuenta nueva: qué conjunto se siembra al crearla, cuándo y con qué
garantías (idempotencia, atomicidad, tolerancia a fallos), y qué NO hace la siembra (límites,
presupuesto, retoques posteriores). Es lo que permite que el triage del onboarding y la
categorización con IA tengan contra qué clasificar desde el primer minuto.
## Requirements
### Requirement: Siembra de categorías por defecto al crear la cuenta

El sistema SHALL crear un conjunto fijo de categorías por defecto para el usuario en el momento
en que su cuenta se crea, sin intervención del usuario y sin pasos adicionales en la UI. La
siembra SHALL ejecutarse en toda alta gestionada por el sistema de autenticación (registro por
email, alta administrativa y scripts que usan la API de autenticación). Los scripts que insertan
`User` directamente en la base con Prisma NO disparan la siembra y siguen a cargo de sus propios
datos.

#### Scenario: Cuenta nueva recibe el set por defecto

- **WHEN** se crea una cuenta de usuario a través del sistema de autenticación
- **THEN** el usuario queda con las categorías por defecto ya disponibles al entrar por primera vez

#### Scenario: Usuario que ya tiene categorías no recibe nada

- **WHEN** la siembra se ejecuta para un usuario que ya tiene al menos una categoría
- **THEN** el sistema no crea ninguna categoría ni modifica las existentes

#### Scenario: Un fallo de la siembra no impide el registro

- **WHEN** la creación de las categorías por defecto falla
- **THEN** la cuenta queda creada y el usuario puede iniciar sesión, quedando el fallo registrado
  en el log del servidor

#### Scenario: La siembra es todo o nada

- **WHEN** la creación del conjunto falla a mitad de camino
- **THEN** no queda ninguna categoría persistida, para que el usuario no arrastre un conjunto
  incompleto que nadie volverá a completar

### Requirement: Contenido del conjunto por defecto

El conjunto SHALL constar de exactamente 10 categorías: 9 de tipo `expense` — Supermercado,
Restaurantes y delivery, Transporte, Salud, Cuentas y servicios, Arriendo o dividendo,
Suscripciones, Compras, Entretenimiento — y 1 de tipo `income` — Sueldo. Los nombres SHALL ser
únicos dentro del conjunto. El conjunto NO SHALL incluir una categoría genérica de tipo "Otros":
los movimientos que no encajan quedan sin categoría y los resuelve el triage.

#### Scenario: Se siembra al menos una categoría de ingreso

- **WHEN** se siembra el conjunto por defecto
- **THEN** existe al menos una categoría de tipo `income`, de modo que el paso de captura de
  ingresos del onboarding tiene dónde asignarlos

#### Scenario: El conjunto no incluye categoría genérica

- **WHEN** se siembra el conjunto por defecto
- **THEN** ninguna categoría del conjunto actúa como cajón genérico ("Otros", "Varios" o similar)

### Requirement: Descripción como contexto de categorización

Cada categoría por defecto SHALL incluir una `description` no vacía redactada como contexto para
la categorización con IA, nombrando comercios y conceptos representativos del mercado chileno.
El sistema ya envía nombre y descripción de las categorías al proveedor de IA; esta capacidad
SHALL aprovechar ese campo y NO SHALL introducir un mecanismo paralelo de contexto.

#### Scenario: La IA recibe las descripciones sembradas

- **WHEN** se categoriza con IA a un usuario que conserva sus categorías por defecto
- **THEN** el proveedor recibe cada categoría con su descripción sembrada como contexto

### Requirement: Sin límites de presupuesto sembrados

La siembra NO SHALL crear registros `CategoryLimit` ni presupuesto global: el sistema no inventa
cifras que el usuario no eligió. En el modelo vigente, una categoría sin registros de límite tiene
límite efectivo de 0 CLP; la distinción entre "no definido" y cero aplica únicamente al límite
global del mes. Los límites siguen definiéndose en el paso de presupuesto del onboarding y en la
UI de presupuesto.

#### Scenario: Categorías sembradas sin presupuesto asignado

- **WHEN** el usuario entra al presupuesto tras la siembra
- **THEN** las categorías por defecto aparecen sin presupuesto asignado y el límite global del mes
  sigue sin definir

### Requirement: Las categorías por defecto no son especiales

Una vez creadas, las categorías por defecto SHALL comportarse como cualquier categoría del
usuario: se pueden renombrar, editar y eliminar con las reglas vigentes, y el sistema NO SHALL
volver a sembrarlas ni restaurarlas después de la creación de la cuenta. Este cambio NO SHALL
agregar activación/desactivación de categorías ni edición dentro del triage.

#### Scenario: El usuario elimina una categoría por defecto

- **WHEN** el usuario elimina una categoría sembrada
- **THEN** se elimina con las reglas vigentes de eliminación y el sistema no la recrea

#### Scenario: El usuario agrega categorías durante el triage

- **WHEN** al triage del onboarding le falta una categoría y el usuario crea una nueva desde ahí
- **THEN** se guarda por el mismo camino que ya usa la creación de categorías, sin que este cambio
  agregue edición ni eliminación en ese paso

