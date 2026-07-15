## ADDED Requirements

### Requirement: Memoria de correcciones de categorización

El modelo SHALL incluir una entidad de **corrección de categorización** por usuario: la descripción
normalizada de un movimiento y su dirección apuntando a la categoría que el usuario eligió, con una
nota opcional que explica qué es el movimiento y una descripción original de ejemplo. SHALL existir a
lo más una corrección por (usuario, dirección, texto normalizado). La corrección referencia la
categoría con borrado en cascada: eliminar la categoría elimina sus correcciones. La entidad es
contexto para la categorización con IA y NO SHALL entrar en ningún cálculo financiero (saldos,
presupuestos, usos).

#### Scenario: Una corrección vigente por texto

- **WHEN** se registra una corrección para un (usuario, dirección, texto normalizado) que ya tiene una
- **THEN** la nueva reemplaza a la anterior; nunca conviven dos para la misma clave

#### Scenario: Borrar la categoría se lleva sus correcciones

- **WHEN** el usuario elimina una categoría con correcciones asociadas
- **THEN** las correcciones se eliminan en cascada

#### Scenario: No afecta cálculos

- **WHEN** se calculan saldos, usos o presupuestos
- **THEN** las correcciones no participan en ninguna fórmula
