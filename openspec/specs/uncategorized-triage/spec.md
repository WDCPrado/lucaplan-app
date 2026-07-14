# uncategorized-triage

## Purpose

Permitir que el usuario categorice rápidamente los movimientos pendientes desde el dashboard,
sin perder elecciones manuales frente a la categorización automática.

## Requirements

### Requirement: Detección persistente de movimientos sin categoría

Al cargar el dashboard, el sistema SHALL buscar los movimientos sin categoría del usuario en
todos los periodos (no solo el mes visible), excluyendo reversados, duplicados e internos
(`isInternal`), ordenados por fecha descendente y con tope de 50 por carga.

#### Scenario: Hay movimientos sin categoría

- **WHEN** el usuario abre el dashboard y existen movimientos con `categoryId = null` elegibles
- **THEN** aparece la superficie de triage con una card por movimiento

#### Scenario: No hay movimientos sin categoría

- **WHEN** el usuario abre el dashboard y todos los movimientos elegibles tienen categoría
- **THEN** la superficie de triage no aparece

#### Scenario: Más movimientos que el tope

- **WHEN** existen más de 50 movimientos sin categoría (se leen 51 para detectarlo)
- **THEN** el stack muestra 50 y un indicador "hay más pendientes"; al recargar aparecen los
  siguientes

### Requirement: Card de triage con selección de categoría

Cada card SHALL mostrar el detalle del movimiento (monto con signo, descripción, banco y
tarjeta, fecha) y chips de categoría filtrados por dirección (gasto ↔ débito, ingreso ↔
crédito). Elegir un chip SHALL persistir la categoría vía el endpoint existente
(`PATCH /api/transactions/:id/category`). Si la IA categoriza en paralelo, la elección manual
SHALL prevalecer: la IA solo puede actualizar el movimiento si `categoryId` continúa nulo.

#### Scenario: Categorizar un movimiento

- **WHEN** el usuario toca un chip de categoría en la card frontal
- **THEN** se persiste la categoría (chips deshabilitados mientras tanto) y, confirmado el
  guardado, la card se anima hacia arriba apilándose en el montón de hechas

#### Scenario: El PATCH falla

- **WHEN** la persistencia falla (red o error del servidor)
- **THEN** la card permanece al frente del stack y se muestra un aviso de error (toast)

#### Scenario: La IA termina después de la elección manual

- **WHEN** el usuario categoriza una card y una categorización de IA concurrente intenta guardar
  después
- **THEN** se conserva la categoría elegida por el usuario

#### Scenario: Usuario sin categorías del lado del movimiento

- **WHEN** no existen categorías del tipo que corresponde a la dirección del movimiento
- **THEN** la card ofrece crear una categoría: cierra el triage y abre el modal de categoría
  existente; el triage reaparece en la próxima carga

### Requirement: Corregir la última categorización

El sistema SHALL permitir recuperar la última card categorizada (arrastre hacia abajo desde
el montón de hechas o botón "Corregir última") para cambiar su categoría; el cambio
re-persiste vía el mismo endpoint. La categoría ya guardada se mantiene hasta que se elija
otra (es corrección, no deshacer a null).

#### Scenario: Recuperar y corregir

- **WHEN** el usuario arrastra hacia abajo desde el montón (o toca "Corregir última")
- **THEN** la última card vuelve al frente con su categoría marcada y elegir otra la
  re-persiste

### Requirement: Superficie descartable y responsive

La superficie de triage SHALL poder cerrarse sin terminar (los movimientos restantes
reaparecen en la próxima carga) y SHALL funcionar en escritorio (~1440px) y móvil (~375px)
con targets táctiles ≥44px, sin scroll horizontal y en dark y light. SHALL comportarse como
diálogo modal accesible: nombre accesible, foco atrapado y restaurado, fondo inerte, scroll de la
página bloqueado y cierre por Escape. Mientras esté abierta, el auto-refresh del dashboard SHALL
quedar pausado.

#### Scenario: Cerrar sin terminar

- **WHEN** el usuario cierra el triage con cards pendientes
- **THEN** la app queda usable y el triage reaparece en la próxima carga del dashboard

#### Scenario: Terminar el triage

- **WHEN** el usuario categoriza la última card del stack
- **THEN** se muestra un resumen (N categorizados) y al cerrar se refrescan los datos del
  dashboard (presupuestos y lista reflejan las categorías nuevas)

#### Scenario: Navegación por teclado

- **WHEN** el usuario abre y recorre el triage solo con teclado
- **THEN** el foco permanece dentro de la superficie, Escape la cierra y el foco vuelve al
  elemento anterior
