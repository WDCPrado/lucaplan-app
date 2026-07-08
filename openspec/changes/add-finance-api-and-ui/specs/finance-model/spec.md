## ADDED Requirements

### Requirement: Presentación de categorías y cuentas

El sistema SHALL soportar campos de presentación opcionales para la UI: `icon` (emoji) y `color`
en categorías, y `color` en cuentas. Estos campos MUST NOT afectar ningún cálculo financiero (uso,
caja activa, estado, posición neta).

#### Scenario: Categoría con emoji y color
- **WHEN** se crea la categoría "Compras" con `icon` 🛍️ y un `color`
- **THEN** la UI la muestra con ese emoji y ese color en el anillo y en los movimientos
- **AND** su límite, uso y estado se calculan igual que sin esos campos

#### Scenario: Presentación es opcional
- **WHEN** una categoría o cuenta no define `icon`/`color`
- **THEN** el sistema usa un valor por defecto y ningún cálculo se ve afectado
