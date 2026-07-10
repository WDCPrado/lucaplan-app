# account-card Specification

## Purpose

Definir la representación visual de una cuenta como **tarjeta bancaria** en LucaPlan: el arte
compuesto por un estilo propio (gradiente por variante) más el isotipo del banco resuelto por
(banco, tipo) con fallback; la presentación de la tarjeta (arte de fondo + overlay de datos
dinámicos: banco, saldo/cupo, últimos 4 dígitos reales, badge de tipo); y el preview en vivo al
crear una cuenta.

## Requirements

### Requirement: Arte de tarjeta por banco y tipo

El sistema SHALL componer el arte de una tarjeta con estilo propio —un color/gradiente por
variante— más el **isotipo del banco** como marca de fondo, resuelto a partir de (banco, tipo de
cuenta). El isotipo se toma de un catálogo estático `public/imagenes/bancos/<banco-slug>/` (un
isotipo por banco). El tipo de cuenta SHALL mapear a la variante: `checking` → débito (azul),
`credit_card` → crédito (negro). Cuando el banco no tenga isotipo o el tipo no tenga tarjeta, el
sistema SHALL usar un **fallback** (color plano) sin mostrar una imagen rota. La estructura del
catálogo SHALL ser estable para migrar luego a un bucket + tabla (banco → url del isotipo).

#### Scenario: Banco de Chile con arte
- **WHEN** una cuenta es de Banco de Chile, tipo corriente (débito)
- **THEN** su tarjeta usa el estilo débito (azul) con el isotipo de Banco de Chile de fondo

#### Scenario: Banco sin arte cae a fallback
- **WHEN** una cuenta es de un banco sin imágenes en el catálogo
- **THEN** la tarjeta se muestra con el color plano de fallback, sin imagen rota

### Requirement: Presentación de la tarjeta

La tarjeta de una cuenta SHALL renderizar el arte de fondo con un overlay de datos **dinámicos**:
el banco, el saldo o cupo, los últimos 4 dígitos (`•••• {cardLast4}`) y un badge del tipo
(débito/crédito). Los datos dinámicos NO SHALL venir quemados en la imagen. La tarjeta SHALL
mostrar los últimos 4 dígitos **reales** de la cuenta, NO los del id interno.

#### Scenario: Muestra últimos 4 dígitos reales
- **WHEN** una cuenta tiene `cardLast4 = "8821"`
- **THEN** la tarjeta muestra `•••• 8821`, no los últimos caracteres del id

#### Scenario: Datos legibles sobre el arte
- **WHEN** la tarjeta se renderiza sobre su imagen de fondo
- **THEN** el saldo/cupo, los 4 dígitos y el tipo se leen con contraste suficiente

### Requirement: Preview al crear la cuenta

El modal de crear cuenta SHALL mostrar en vivo la tarjeta con el arte correspondiente cuando el
usuario elige banco y tipo, y SHALL exigir los últimos 4 dígitos solo cuando el tipo tiene tarjeta
(corriente o crédito).

#### Scenario: Preview reacciona a banco y tipo
- **WHEN** el usuario elige Banco de Chile y tipo crédito
- **THEN** el preview muestra el arte de crédito de Banco de Chile con los datos ingresados

#### Scenario: Campo de 4 dígitos según tipo
- **WHEN** el usuario elige un tipo con tarjeta (corriente o crédito)
- **THEN** aparece el campo obligatorio de últimos 4 dígitos; para ahorro/billetera no aparece
