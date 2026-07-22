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
