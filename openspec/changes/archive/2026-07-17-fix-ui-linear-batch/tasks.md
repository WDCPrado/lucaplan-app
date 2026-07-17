# Tasks: fix-ui-linear-batch

## 1. LUCA-7 — Categoría del movimiento primero en los chips

- [x] 1.1 `transaction-modal.tsx`: ordenar `visibleCategories` con la categoría guardada del movimiento (`tx.categoryId`) primero, orden estable por apertura (no reordenar al cambiar la selección); adelantar solo si pasa el filtro por tipo (al cambiar `direction` en `EditForm` no se reinserta ni reordena); aplicar en `EditForm` y `ConnectedDetail`

## 2. LUCA-1 — Scroll shadcn en detalle de categoría

- [x] 2.1 `category-detail-sheet.tsx`: en escritorio, cabecera (anillo/cifras/Editar) fija y lista de movimientos dentro de `ScrollArea` de shadcn; override del contenedor SOLO con prefijo `md:` (el `className` de `ResponsiveModal` llega también al drawer móvil) y cadena de alturas completa (`md:overflow-hidden md:flex md:flex-col` + `min-h-0 flex-1` hasta el `ScrollArea`); móvil conserva su scroll actual

## 3. LUCA-2 — Toggle de tema refleja el tema activo

- [x] 3.1 `app-shell.tsx` (UserMenu): cambiar las variantes del item de tema de `dark:*` a `[html.dark_&]:*` (Sol/Luna y "Tema claro"/"Tema oscuro"), manteniendo la técnica CSS sin JS

## 4. LUCA-6 — Lupa flotante del porte del FAB agregar

- [x] 4.1 `app-shell.tsx`: FAB de búsqueda `size-12` → `size-14` e icono `size-5` → `size-6`, conservando `variant="secondary"`

## 5. Verificación y cierre

- [x] 5.1 `pnpm typecheck` + `pnpm lint` en verde
- [x] 5.2 Playwright en ~1440px y ~420px, dark + light: chips con categoría primero, scroll solo en la lista del detalle (escritorio), toggle de tema mostrando el opuesto y alternando bien, FABs del mismo porte; screenshot final
- [x] 5.3 Linear: marcar checkboxes en la sección `## Claude Code` de LUCA-1/2/6/7 y mover las 4 tarjetas a Done
