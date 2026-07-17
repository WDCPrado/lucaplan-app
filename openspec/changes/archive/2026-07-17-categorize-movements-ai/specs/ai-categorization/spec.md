## ADDED Requirements

### Requirement: Categorización automática de movimientos

El sistema SHALL asignar automáticamente una categoría a los movimientos **sin categoría** usando un
proveedor de IA, a partir de las categorías del usuario (nombre, tipo y descripción). Al importar
desde el proveedor bancario, la **primera** conexión SHALL categorizar todo el histórico importado y
cada sincronización posterior SHALL categorizar **solo** los movimientos recién importados que queden
sin categoría. Un movimiento que ya tiene categoría (asignada por IA o por el usuario) NO SHALL
re-categorizarse.

#### Scenario: Primera conexión categoriza todo lo importado
- **WHEN** el usuario conecta un banco por primera vez y se importan sus movimientos históricos
- **THEN** cada movimiento sin categoría recibe una categoría sugerida por la IA

#### Scenario: Sincronización posterior categoriza solo lo nuevo
- **WHEN** una sincronización trae movimientos nuevos y deja intactos los ya importados
- **THEN** la IA categoriza únicamente los nuevos sin categoría, sin tocar los ya categorizados

#### Scenario: No re-categoriza lo ya categorizado
- **WHEN** un movimiento ya tiene categoría y vuelve en una sincronización
- **THEN** conserva su categoría y la IA no la reemplaza

### Requirement: Regla de lado en la categorización

La IA SHALL elegir únicamente entre categorías del **mismo lado** que el movimiento: una categoría de
tipo `income` solo a un movimiento `credit` y una de tipo `expense` solo a un `debit`. El conjunto de
categorías candidatas que se envía a la IA MUST estar ya filtrado por ese lado, y el id devuelto MUST
validarse contra ese conjunto; si la IA devuelve un id fuera del conjunto permitido (o inválido), el
movimiento SHALL quedar **sin categoría** en vez de recibir una del lado equivocado.

#### Scenario: Ingreso solo recibe categoría de ingreso
- **WHEN** se categoriza un movimiento `credit`
- **THEN** solo puede recibir una categoría de tipo `income`; nunca una de gasto

#### Scenario: Id inválido no fuerza categoría equivocada
- **WHEN** la IA devuelve un id que no está entre las categorías del lado del movimiento
- **THEN** el movimiento queda sin categoría para clasificarse a mano, sin asignar una del lado incorrecto

### Requirement: Proveedor de IA detrás de un port (OpenAI por ahora)

La categorización SHALL usar la API de **OpenAI** (Chat Completions) configurada por variables de
entorno del servidor: `OPENAI_API_KEY` y `OPENAI_MODEL`. El proveedor MUST estar detrás de un **port**
(`CategorizationProvider`) para poder reemplazarlo por otro adapter sin modificar la capa de
aplicación. La llamada SHALL ejecutarse **solo en el servidor**; la API key NUNCA SHALL llegar al
cliente. El proveedor SHALL devolver, para cada movimiento, el id de la categoría elegida (o ninguna)
en un formato estructurado (JSON) que el sistema pueda parsear de forma determinista.

#### Scenario: La key no sale del servidor
- **WHEN** se ejecuta la categorización
- **THEN** la llamada al proveedor ocurre en el backend y la API key nunca se expone al cliente

#### Scenario: Proveedor intercambiable por el port
- **WHEN** se quiera cambiar OpenAI por otro proveedor de IA
- **THEN** basta con implementar otro adapter del port `CategorizationProvider`, sin tocar el use-case de categorización

### Requirement: Degradación elegante sin IA configurada

Si el proveedor de IA no está configurado, o la llamada falla o devuelve algo no parseable, la categorización SHALL **omitirse** sin interrumpir la importación ni la sincronización.
Los movimientos afectados quedan **sin categoría** para clasificarse a mano. Un fallo de la IA NUNCA
SHALL abortar el import ni perder movimientos.

#### Scenario: Sin configuración de IA no rompe el import
- **WHEN** faltan las variables de entorno del proveedor de IA y se importan movimientos
- **THEN** los movimientos se guardan sin categoría y la sincronización termina con éxito

#### Scenario: Fallo del proveedor no aborta la sincronización
- **WHEN** el proveedor de IA responde con error o un cuerpo no parseable
- **THEN** los movimientos quedan sin categoría y el resto de la sincronización continúa normalmente

### Requirement: Descripción de categoría como contexto

La IA SHALL recibir, para cada categoría candidata, su **descripción opcional** (además del nombre y
el tipo) como contexto para mejorar la asignación. Una categoría sin descripción SHALL categorizarse
igual usando solo su nombre y tipo.

#### Scenario: La descripción guía la elección
- **WHEN** dos categorías tienen nombres ambiguos pero descripciones que las distinguen
- **THEN** la IA usa las descripciones para elegir la más adecuada al movimiento

#### Scenario: Categoría sin descripción sigue funcionando
- **WHEN** una categoría no define descripción
- **THEN** la IA la considera igual, usando su nombre y tipo
