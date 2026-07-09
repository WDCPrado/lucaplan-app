# app-shell Specification

## Purpose

Definir la estructura de navegación y el layout responsive de la app autenticada de LucaPlan:
un shell **desktop-first** con sidebar fija que colapsa en móvil, contenedor y grid de contenido
multi-columna, superficies contextuales que adaptan su presentación al viewport (diálogo en
escritorio, sheet en móvil), y las invariantes de responsividad que toda vista debe cumplir en
ambos extremos y en dark/light.

## Requirements

### Requirement: Navegación por sidebar desktop-first

La app autenticada SHALL presentar la navegación principal en una **sidebar fija a la
izquierda** en viewports de escritorio (ancho ≥ `lg`, 1024px). La sidebar SHALL contener la
identidad de la app, los destinos de navegación y una zona de usuario/acciones. En viewports
de móvil (< `lg`) la sidebar SHALL colapsar en un menú accesible (drawer off-canvas o
bottom-nav) para preservar la navegación táctil, y NO SHALL ocupar espacio permanente en
pantalla. La sidebar SHALL reflejar únicamente destinos existentes; NO SHALL inventar vistas
que no existen (los destinos sin pantalla propia quedan como placeholders inertes o se omiten).

#### Scenario: Escritorio muestra sidebar fija
- **WHEN** un usuario autenticado abre la app en un viewport ≥ 1024px
- **THEN** ve una sidebar fija a la izquierda con la navegación, y el contenido ocupa el
  espacio restante a la derecha

#### Scenario: Móvil colapsa la navegación
- **WHEN** el mismo usuario abre la app en un viewport < 1024px (p. ej. 375px)
- **THEN** la sidebar no ocupa espacio permanente y la navegación queda disponible mediante un
  control táctil (drawer o bottom-nav), sin desbordar el ancho

### Requirement: Layout de contenido adaptativo

El contenido SHALL abandonar el contenedor angosto `max-w-md` y usar el ancho disponible con
un `max-w` amplio en escritorio. En viewports de escritorio el contenido SHALL distribuirse en
**múltiples columnas** (p. ej. cuentas en grid, y Movimientos / Presupuestos en columnas
paralelas). En móvil el contenido SHALL apilarse en una sola columna. Ningún layout SHALL
producir scroll horizontal de la página.

#### Scenario: Escritorio aprovecha el ancho en columnas
- **WHEN** el dashboard se renderiza en un viewport ≥ 1024px
- **THEN** las cuentas se muestran en grid (no en carrusel horizontal) y Movimientos y
  Presupuestos se muestran en columnas paralelas usando el ancho disponible

#### Scenario: Móvil apila en una columna sin desbordar
- **WHEN** el dashboard se renderiza en un viewport de ~375px
- **THEN** el contenido se apila en una sola columna y no hay scroll horizontal de la página

### Requirement: Superficies contextuales adaptativas

Las superficies contextuales SHALL adaptar su presentación al viewport. Las acciones que abren
una superficie (agregar movimiento, crear/editar categoría, detalle de categoría, crear cuenta)
SHALL usar un panel/diálogo apropiado a escritorio y una superficie táctil (sheet) en móvil. La
superficie SHALL preservar el mismo contenido y comportamiento funcional en ambos tamaños; solo
cambia su presentación.

#### Scenario: Formulario se presenta según viewport
- **WHEN** el usuario abre "agregar movimiento" en escritorio
- **THEN** se presenta como diálogo/panel apropiado a escritorio (no como sheet a pantalla
  completa), y en móvil la misma acción se presenta como sheet táctil

#### Scenario: Paridad funcional entre superficies
- **WHEN** la misma acción se realiza en escritorio y en móvil
- **THEN** los campos, validaciones y resultado son equivalentes; solo difiere la presentación

### Requirement: Invariantes de responsividad

Todas las vistas de la app SHALL cumplir, en escritorio y en móvil y en dark y light:
la altura usa `min-h-dvh` (no `100vh`); no hay scroll horizontal accidental; los targets
táctiles interactivos MUST medir ≥44px y el texto de entrada ≥16px en móvil para evitar zoom
de iOS. El rediseño desktop-first NO SHALL introducir regresiones de usabilidad en móvil.

#### Scenario: Sin scroll horizontal en ningún ancho
- **WHEN** cualquier vista se renderiza entre 320px y anchos de escritorio
- **THEN** no aparece scroll horizontal de la página

#### Scenario: Targets táctiles y texto legibles en móvil
- **WHEN** una vista con controles interactivos se renderiza en móvil
- **THEN** los controles miden ≥44px y los inputs usan texto ≥16px

#### Scenario: Correcto en ambos temas
- **WHEN** una vista se verifica en dark y en light
- **THEN** el layout y el contraste se mantienen correctos en ambos temas
