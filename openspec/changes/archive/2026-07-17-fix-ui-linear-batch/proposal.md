# Proposal: fix-ui-linear-batch

## Why

Cuatro tarjetas de Linear (proyecto **Luca Plan App**) están "In Progress" y son fixes simples de
UI que conviene resolver en un solo lote: fricciones visibles del día a día que no ameritan un
cambio OpenSpec cada una.

## What Changes

- **LUCA-7 — Categoría seleccionada primero en el modal de movimiento.** En `TransactionModal`
  (edición y detalle conectado), si el movimiento ya tiene categoría, su chip aparece **primero**
  en la lista horizontal; hoy queda enterrado según el orden de creación.
- **LUCA-1 — Scroll shadcn en el detalle de categoría.** En escritorio, el modal de detalle de
  categoría deja la cabecera (anillo, cifras, botón Editar) **fija** y solo la lista de
  movimientos hace scroll, con `ScrollArea` de shadcn (no overflow nativo del contenedor).
- **LUCA-2 — Toggle de tema no refleja el tema activo.** El item "Tema claro/oscuro" del menú de
  usuario siempre muestra el mismo icono/texto: el `DropdownMenuContent` base lleva la clase
  `dark` fija (estética glass oscura deliberada del style `radix-maia`), y las utilidades `dark:`
  del item ven ese wrapper en vez del tema real. Se anclan las variantes al `<html>`
  (`[html.dark_&]:`), conservando la técnica CSS sin JS ni mismatch de hidratación.
- **LUCA-6 — Lupa flotante del mismo porte que "agregar".** El FAB de búsqueda pasa de `size-12`
  (icono `size-5`) a `size-14` (icono `size-6`), igual que el FAB de agregar; mantiene su
  variante secundaria.

**Fuera de alcance**: cualquier otro rediseño de esos componentes; quitar la clase `dark` del
dropdown base (es una decisión estética del design system, no un bug).

## Capabilities

### New Capabilities

(ninguna)

### Modified Capabilities

- `finance-ui`: el detalle de categoría especifica cabecera fija + lista con scroll shadcn en
  escritorio (MODIFIED); nuevo requirement del orden de chips de categoría en el modal de
  movimiento (ADDED).
- `app-shell`: nuevos requirements de acciones flotantes con tamaño consistente y de toggle de
  tema que refleja el tema activo (ADDED).

## Impact

- **Solo presentación** (client components); sin cambios de dominio, application, infra, API ni
  modelo de datos.
- `components/finance/transaction-modal.tsx` (orden de chips en `EditForm` y `ConnectedDetail`).
- `components/finance/category-detail-sheet.tsx` (+ `ResponsiveModal` vía props/clases; shadcn
  `ScrollArea` ya instalado).
- `components/finance/app-shell.tsx` (item de tema del `UserMenu`; tamaño del FAB de búsqueda).
- **Linear**: LUCA-1, LUCA-2, LUCA-6, LUCA-7 se documentan y cierran con este cambio.
