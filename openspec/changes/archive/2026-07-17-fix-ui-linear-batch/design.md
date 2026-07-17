# Design: fix-ui-linear-batch

## Context

Cuatro fixes de UI reportados en Linear, todos en client components de presentación. Causas ya
diagnosticadas en código (y LUCA-2 reproducido en vivo con Playwright):

- `transaction-modal.tsx`: los chips de categoría (`visibleCategories`) respetan el orden de
  creación; la categoría del movimiento puede quedar fuera de la vista en el scroll-x.
- `category-detail-sheet.tsx`: todo el contenido del `ResponsiveModal` scrollea (el
  `DialogContent` tiene `overflow-y-auto`); la cabecera con el anillo se va con el scroll.
- `app-shell.tsx` (UserMenu): el item de tema decide icono/texto con utilidades `dark:`
  (`hidden dark:block`, etc.). El `DropdownMenuContent` base
  ([components/ui/dropdown-menu.tsx](../../../components/ui/dropdown-menu.tsx)) trae la clase
  `dark` **fija** (glass oscuro deliberado del style `radix-maia`), así que
  `@custom-variant dark (&:is(.dark *))` matchea siempre por el wrapper: el item muestra
  permanentemente Sol + "Tema claro" aunque el tema real cambie.
- `app-shell.tsx` (FABs): búsqueda `size-12`/icono `size-5` vs agregar `size-14`/icono `size-6`.

## Goals / Non-Goals

**Goals:** resolver los 4 fixes con el diff mínimo, solo capa de presentación.

**Non-Goals:** quitar la clase `dark` del dropdown base (decisión estética del design system);
tocar el toggle del login (no está dentro de un wrapper `.dark`, funciona bien); reordenar chips
en `add-transaction-sheet` (movimiento nuevo no tiene categoría previa).

## Decisions

### D1 — Chips: la categoría del movimiento primero, orden estable (LUCA-7)

Ordenar `visibleCategories` poniendo primero la categoría **guardada** del movimiento
(`tx.categoryId`), no la selección en pantalla: si se reordenara al tocar cada chip, la lista
saltaría bajo el dedo. Orden fijo por apertura del modal; el resto conserva su orden. Aplica a
`EditForm` y `ConnectedDetail`.

Borde (hallazgo Codex): en `EditForm`, al cambiar `direction` el filtro por tipo puede excluir la
categoría guardada — se adelanta **solo si** `tx.categoryId` está dentro de `visibleCategories`;
nunca se reinserta una categoría del otro lado ni se reordena tras `changeDirection`.

### D2 — Detalle de categoría: cabecera fija + `ScrollArea` (LUCA-1)

En escritorio, el contenido del modal pasa a `flex flex-col` con altura acotada: la cabecera
(anillo/cifras/Editar) queda fija y la lista de movimientos vive dentro de un `ScrollArea` de
shadcn (`components/ui/scroll-area.tsx`, ya instalado) que absorbe el overflow. Se anula el
scroll del contenedor del `Dialog` para esta superficie vía la prop `className` que
`ResponsiveModal` ya acepta. En móvil el drawer mantiene su scroll full-height actual (el pedido
es explícitamente desktop).

Detalles clave (hallazgos Codex):

- `ResponsiveModal` pasa el mismo `className` al `DrawerContent` móvil — las clases del override
  van con prefijo **`md:`** (`md:overflow-hidden md:flex md:flex-col`). El breakpoint de
  `useIsMobile` (768px) coincide con `md:`, así que en el drawer nunca aplican y en el dialog
  siempre.
- La cadena de alturas debe quedar acotada completa o el scroll se cae al modal: contenedor
  `md:overflow-hidden md:flex md:flex-col` → zona de lista `min-h-0 flex-1`. Verificado en vivo:
  el viewport de Radix (`size-full`) resuelve `height:100%` solo contra alturas **definidas** —
  la altura flex del root no le basta y la lista no recorta. Además el Root de Radix trae
  `position: relative` **inline** (una clase no puede volverlo absolute). Solución: div
  `md:absolute md:inset-0` envolviendo el `ScrollArea` (con `md:h-full`), dentro de un
  `md:relative md:min-h-0 md:flex-1` — eso sí le da altura definida al viewport.

### D3 — Toggle de tema anclado al `<html>` (LUCA-2)

Mantener la técnica CSS sin JS (sin mismatch de hidratación), cambiando el ancla: las variantes
del item pasan de `dark:*` (ancestro más cercano — el wrapper `dark` del dropdown) a la variante
arbitraria `[html.dark_&]:*`, que solo mira la clase del `<html>` (la que controla next-themes).

- Sol: `hidden [html.dark_&]:block` · Luna: `[html.dark_&]:hidden`
- "Tema claro": `hidden [html.dark_&]:inline` · "Tema oscuro": `[html.dark_&]:hidden`

Alternativa descartada: renderizar por estado con `resolvedTheme` — exige guard de `mounted` y
reintroduce el problema que el comentario del código ya evitó a propósito.

### D4 — FAB de búsqueda al porte del de agregar (LUCA-6)

`size-12` → `size-14` y el icono `size-5` → `size-6`, manteniendo `variant="secondary"` (la
jerarquía visual la da el color, no el tamaño). Cumple de sobra el target táctil ≥44px.

## Risks / Trade-offs

- [El `ScrollArea` con altura acotada puede verse corto en pantallas bajas] → altura relativa al
  viewport (`max-h` en dvh) y verificación Playwright en 1440px y 420px.
- [Otros usos de utilidades `dark:` dentro de dropdowns siguen viendo el wrapper `dark`] →
  comportamiento esperado del design system (el menú ES oscuro); solo el item de tema necesita
  reflejar el tema global, por eso el fix es local y no global.

## Migration Plan

Solo componentes cliente; deploy normal, sin migraciones. Rollback: revertir el commit.

## Open Questions

(ninguna)
