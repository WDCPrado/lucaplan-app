# Design: transaction-budget-arcs

## Context

`listTransactions` y `getCategoryDetail` ya calculan el restante histórico por movimiento
(`historicalRemaining` → `TransactionDTO.remaining`): lo que quedaba del límite de la categoría
justo tras ese gasto. `MovementRow` lo muestra como texto "Quedan $X" bajo la descripción, con el
icono de categoría en un círculo plano. Los anillos de Presupuestos usan `ProgressRing`
(percent + color por estado `bueno`/`moderado`/`completado`/`excedido`).

## Goals / Non-Goals

**Goals:** arco visual del restante en cada fila de movimiento con "Quedan", consistente con los
anillos de Presupuestos; diff mínimo.

**Non-Goals:** arcos en la búsqueda de movimientos (no calcula "quedan", que es propio de la
vista por periodo); tocar el cálculo de `remaining`; arcos para ingresos.

## Decisions

### D1 — El porcentaje se deriva de datos ya existentes + `categoryLimit` en el DTO

`% usado en ese punto = (límite − quedan) / límite`. El `remaining` ya viaja en el DTO; falta el
límite: se agrega `TransactionDTO.categoryLimit: number | null` (el límite efectivo del mes de la
categoría, que `listTransactions` ya tiene en `limitById` y `getCategoryDetail` en `limit`). En
`searchTransactions` va `null` (ahí tampoco hay `remaining`). Aditivo y barato — no se persiste
nada. Implica extender la firma de `txToDTO` (hoy no recibe límite) y actualizar los datos demo
tipados como `TransactionDTO` (landing y `app/design/desktop-shell`). La condición única de
render del arco es `remaining !== null && categoryLimit !== null`; los `pending` no llevan arco
porque `historicalRemaining` solo acumula `confirmed` (remaining `null`). Moneda: `categoryLimit`
es un número CLP como todo el presupuesto actual — si algún día hay presupuesto multi-moneda,
esta feature hereda esa brecha, no la crea.

- Alternativa descartada: pasar un mapa categoría→límite por props desde el dashboard hasta cada
  fila — atraviesa 3 niveles de componentes para algo que la capa de lectura ya sabe.

### D2 — Mini `ProgressRing` alrededor del icono, mismo lenguaje visual

En `MovementRow`, cuando `remaining !== null && categoryLimit !== null`: el círculo del icono
(size-11 = 44px) se envuelve en un `ProgressRing` `size={44}` `stroke={3.5}` con el círculo de
color de fondo reducido dentro (~size-9). El estado del arco usa los mismos umbrales que
`categoryStatus` (≤50% `bueno`, <100% `moderado`, =100% `completado`, >100% `excedido`), derivado
en el componente con un helper local de 4 líneas sobre `usado/límite` (los umbrales son
presentación aquí; no vale la pena importar dominio al cliente por esto).

Bordes:

- `límite = 0` con gasto → `excedido` (arco lleno en color de alerta), sin división por cero.
- `remaining < 0` → `excedido` (el `ProgressRing` ya capea el arco a 100%).
- Sin `remaining` o sin límite (ingresos, sin categoría, búsqueda) → círculo plano actual, sin
  anillo.

### D3 — Sin cambios en móvil vs escritorio

La fila es la misma en ambos; el anillo de 44px mantiene el target táctil de la fila completa.

## Risks / Trade-offs

- [Ruido visual si hay muchos movimientos] → el arco reemplaza el aro implícito del círculo de
  color, no agrega un elemento nuevo; mismo tamaño total (44px). Verificación visual en ambos
  temas decide ajustes de stroke.
- [`TransactionDTO` crece] → un campo opcional derivado; los consumidores existentes no cambian.

## Migration Plan

Solo lectura + componente cliente; deploy normal. Rollback: revertir commit.

## Open Questions

(ninguna)
