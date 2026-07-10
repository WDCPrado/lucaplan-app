## ADDED Requirements

### Requirement: Descripción opcional de categoría

Una categoría MAY tener una **descripción** opcional (texto libre) que aclara qué movimientos le corresponden y MUST NOT afectar ningún cálculo financiero (límite, uso, caja activa, estado, posición neta).
La descripción se usa como contexto para la categorización con IA (ver `ai-categorization`). Una
categoría sin descripción SHALL comportarse exactamente como hasta ahora.

#### Scenario: Categoría con descripción
- **WHEN** se crea la categoría "Supermercado" con la descripción "compras de comida y hogar en super/almacén"
- **THEN** la descripción se guarda y queda disponible como contexto para la IA
- **AND** su límite, uso y estado se calculan igual que sin descripción

#### Scenario: Descripción es opcional
- **WHEN** una categoría no define descripción
- **THEN** el sistema la trata como vacía y ningún cálculo ni comportamiento cambia
