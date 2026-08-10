# categorization-learning Specification

## Purpose
TBD - created by archiving change add-categorization-learning. Update Purpose after archive.
## Requirements
### Requirement: Registro de correcciones al categorizar a mano

Una asignación manual de categoría SHALL registrar una **corrección** persistente del usuario —la
descripción **normalizada** más su dirección, apuntando a la categoría elegida— **cuando ese texto
todavía no tenga una corrección vigente**, o cuando la vigente ya apunte a la misma categoría. Si
existe una corrección vigente hacia **otra** categoría, la asignación NO SHALL reemplazarla: una
recategorización suele ser la excepción y no una regla nueva, y pisarla en silencio cambiaría la
clasificación de todos los movimientos futuros de ese comercio. En ese caso el sistema SHALL
informar cuál es la categoría aprendida, para que el usuario decida en el follow-up. El registro
MUST ser best-effort: un fallo NUNCA SHALL impedir la asignación de la categoría. Quitar la
categoría (asignar null) NO SHALL registrar ni borrar correcciones.

#### Scenario: Primera corrección de un texto

- **WHEN** el usuario cambia la categoría de un movimiento «PAGO:PAYU \*UBER EATS 1234» y ese texto no tenía corrección
- **THEN** queda registrada una corrección (texto normalizado → categoría elegida) para ese usuario y dirección

#### Scenario: Recategorizar una excepción no cambia lo aprendido

- **WHEN** el texto ya tenía una corrección hacia "Supermercado" y el usuario recategoriza un movimiento suyo a "Regalos"
- **THEN** el movimiento queda en "Regalos", la corrección sigue apuntando a "Supermercado" y el sistema informa esa categoría aprendida

#### Scenario: No conviven correcciones contradictorias

- **WHEN** una corrección del mismo texto se reemplaza por decisión explícita del usuario
- **THEN** persiste solo la última; no conviven correcciones contradictorias del mismo texto

#### Scenario: Quitar categoría no toca la memoria

- **WHEN** el usuario deja un movimiento sin categoría (asigna null)
- **THEN** no se crea corrección nueva y las existentes quedan intactas

#### Scenario: Fallo del registro no bloquea la asignación

- **WHEN** el guardado de la corrección falla (p. ej. error de BD transitorio)
- **THEN** la categoría del movimiento queda asignada igual y la operación responde con éxito

### Requirement: Captura del porqué

Tras una asignación manual de categoría, la UI SHALL ofrecer capturar una **nota corta** («¿Qué es
este movimiento?») que explique qué es ese movimiento en la vida del usuario. La nota SHALL ser
**opcional**: el usuario puede omitirla y la corrección queda registrada igual sin nota. La nota
SHALL guardarse en la corrección y usarse como contexto para la IA.

#### Scenario: El usuario explica el movimiento

- **WHEN** el usuario recategoriza «PAGO:PAYU \*UBER EATS» a "Comida" y escribe «pedidos de comida a domicilio»
- **THEN** la corrección guarda la nota y esta se inyecta como contexto en futuras categorizaciones

#### Scenario: El usuario omite el porqué

- **WHEN** el usuario recategoriza y descarta el follow-up sin escribir nada
- **THEN** la corrección queda registrada sin nota y funciona igual (texto → categoría)

### Requirement: Propagación a movimientos con el mismo texto

Tras una asignación manual, el sistema SHALL informar cuántos **otros** movimientos del usuario
comparten el mismo texto normalizado y dirección, y SHALL permitir aplicarles la misma categoría en
una acción explícita del usuario. La propagación NUNCA SHALL ejecutarse automáticamente sin
confirmación, y SHALL operar solo sobre movimientos de la misma dirección (regla de lado).

Esa misma acción explícita SHALL ser la decisión sobre la **memoria**: al aplicar a los demás, la
corrección vigente del texto SHALL reemplazarse por la categoría elegida. Al elegir "solo este",
la corrección vigente y su nota SHALL quedar intactas, porque la nota describe la excepción y no
la regla. Cuando el texto tiene una corrección hacia otra categoría, la UI SHALL ofrecer confirmar
el cambio de regla aunque no existan otros movimientos que propagar.

#### Scenario: Aplicar a los demás reemplaza la regla

- **WHEN** el texto estaba aprendido como "Supermercado", el usuario recategoriza a "Regalos" y elige aplicar a los demás
- **THEN** la corrección pasa a apuntar a "Regalos" y los movimientos del mismo texto la reciben

#### Scenario: «Solo este» conserva la regla y no le pega la nota

- **WHEN** el usuario recategoriza a "Regalos", escribe una nota y elige "solo este"
- **THEN** la corrección sigue apuntando a "Supermercado", sin la nota de la excepción

#### Scenario: Aplicar a los N con la misma descripción

- **WHEN** el usuario recategoriza un movimiento y existen 7 movimientos más con el mismo texto normalizado y dirección
- **THEN** la UI ofrece «aplicar a los 7» y, al confirmar, todos reciben esa categoría

#### Scenario: Sin coincidencias no se ofrece nada

- **WHEN** ningún otro movimiento comparte el texto normalizado
- **THEN** no se ofrece propagación

#### Scenario: La propagación no cruza de lado

- **WHEN** existe un movimiento con el mismo texto pero dirección contraria (p. ej. un reembolso)
- **THEN** ese movimiento no entra en el conteo ni recibe la categoría

### Requirement: Inyección de correcciones en la categorización IA

Antes de cada pasada de categorización automática, el sistema SHALL buscar las correcciones del
usuario **del mismo lado** que matcheen los movimientos del lote y SHALL inyectarlas dinámicamente
en el contexto del proveedor de IA: una corrección con **texto exacto** igual al de un movimiento
del lote SHALL inyectarse siempre, con la instrucción de usar esa categoría; una corrección con
**texto parecido** SHALL inyectarse como pista fuerte junto con su nota. La decisión final sigue
siendo de la IA y el id devuelto MUST validarse contra el conjunto permitido, como en toda
categorización. Las correcciones de un lado NUNCA SHALL ofrecerse para movimientos del lado
contrario.

#### Scenario: El mismo texto vuelve a aparecer

- **WHEN** llega un movimiento nuevo cuyo texto normalizado coincide exacto con una corrección previa
- **THEN** la corrección se inyecta al prompt con instrucción de usar esa categoría y el movimiento la recibe

#### Scenario: Un texto parecido se beneficia de la corrección

- **WHEN** llega «PAYU \*UBEREATS SANTIAGO» y existe una corrección para «PAGO:PAYU \*UBER EATS» con nota «pedidos de comida»
- **THEN** la corrección se inyecta como pista y la IA puede elegir la misma categoría aunque el texto no sea idéntico

#### Scenario: Corrección de gasto no contamina ingresos

- **WHEN** se categoriza un lote de créditos y existe una corrección de un texto igual pero de dirección débito
- **THEN** esa corrección no se inyecta para ese lote

### Requirement: Matching por texto normalizado y similitud

El matching SHALL usar una **normalización determinista** compartida entre registro, propagación y
retrieval: mayúsculas, sin tildes, espacios colapsados y remoción de secuencias variables (series de
4+ dígitos y fechas), de modo que operaciones distintas del mismo comercio produzcan el mismo texto
normalizado. La similitud para «texto parecido» SHALL calcularse por solapamiento de tokens
significativos con un umbral definido en código. El número de correcciones inyectadas por prompt
MUST tener un tope, priorizando las exactas y luego las parecidas por score.

#### Scenario: Números de operación distintos matchean exacto

- **WHEN** dos compras del mismo comercio difieren solo en número de operación y fecha dentro de la descripción
- **THEN** ambas normalizan al mismo texto y matchean como coincidencia exacta

#### Scenario: El prompt no crece sin límite

- **WHEN** el usuario acumula cientos de correcciones y un lote matchea con muchas de ellas
- **THEN** solo se inyecta hasta el tope definido, con las exactas primero

### Requirement: Degradación elegante del aprendizaje

Sin correcciones registradas, la categorización SHALL comportarse exactamente como hoy. Un fallo del
retrieval de correcciones NUNCA SHALL abortar la pasada de categorización (se degrada a categorizar
sin correcciones), y un fallo del registro o de la propagación NUNCA SHALL revertir ni bloquear la
asignación manual ya hecha.

#### Scenario: Usuario nuevo sin correcciones

- **WHEN** un usuario sin correcciones registradas sincroniza movimientos
- **THEN** la categorización corre igual que hoy, sin sección de correcciones en el prompt

#### Scenario: Retrieval caído no rompe la sincronización

- **WHEN** la consulta de correcciones falla durante una pasada de categorización
- **THEN** el lote se categoriza sin correcciones y la sincronización termina con éxito

