# Delta: app-shell

## ADDED Requirements

### Requirement: Acciones flotantes de tamaño consistente

Las acciones flotantes del shell (buscar y agregar) SHALL tener el **mismo tamaño** de botón e
icono; la jerarquía entre ambas SHALL expresarse por variante de color (primaria para agregar,
secundaria para buscar), no por tamaño. Ambas MUST cumplir el target táctil mínimo (≥44px).

#### Scenario: Lupa y agregar del mismo porte

- **WHEN** el usuario ve las acciones flotantes abajo a la derecha
- **THEN** la lupa y el "+" tienen el mismo diámetro y tamaño de icono, diferenciándose solo por color

### Requirement: Toggle de tema refleja el tema activo

El control de cambio de tema del menú de usuario SHALL mostrar el icono y el texto
correspondientes al **tema global activo** (el del `<html>`, controlado por next-themes),
ofreciendo siempre el tema opuesto como acción. El control MUST comportarse igual aunque viva
dentro de una superficie con tema forzado (p. ej. el dropdown glass oscuro del design system).

#### Scenario: En tema claro ofrece el oscuro

- **WHEN** la app está en tema claro y el usuario abre el menú de usuario
- **THEN** el item muestra la luna y el texto "Tema oscuro"

#### Scenario: Alternar actualiza el control

- **WHEN** el usuario alterna el tema desde el item
- **THEN** la app cambia de tema y el item pasa a mostrar el icono/texto del tema opuesto, aunque el menú tenga fondo oscuro forzado
