## 1. Lectura de sin categoría (backend)

- [x] 1.1 Agregar `uncategorized?: boolean` a `TransactionSearchFilters` en
      `arch/v1/domain/finance/finance.domain.ts`
- [x] 1.2 Implementar el filtro en el repo Prisma — el flag `uncategorized` mete TODO el
      criterio al `where` (`categoryId: null`, status elegible, `isInternal: false`) en
      `arch/v1/infrastructure/database/prisma/finance.infrastructure.ts`
- [x] 1.3 Nueva lectura `listUncategorized(deps, userId)` en
      `arch/v1/application/finance-use-cases/finance-read.ts` (orden fecha desc, pide 51 y
      devuelve `{ transactions: 50, hasMore }`) + test con `node --test`
- [x] 1.4 Agregar escritura condicional de categoría para la IA (`categoryId IS NULL`) en el port
      y repo Prisma; usarla desde `categorizeMovements` + test de carrera donde gana el usuario
- [x] 1.5 Cargar `uncategorized` en `app/dashboard/page.tsx` (mismo `Promise.all`) y pasarla
      como prop a `Dashboard`

## 2. UI del triage (stack de cards)

- [x] 2.1 Componente `components/finance/uncategorized-triage.tsx`: contenido full-screen sobre
      `Dialog` (portal, nombre accesible, focus trap/restauración, fondo inerte y scroll lock),
      stack (card frontal + 2-3 detrás con scale/translateY), contador, montón de hechas y cerrar
- [x] 2.2 Card con detalle del movimiento (monto/signo/color, descripción, banco · tarjeta,
      fecha) y chips de categoría filtrados por dirección (reutilizar el patrón savedFirst /
      Chip del transaction-modal); CTA de crear categoría cuando no hay del lado
- [x] 2.3 Categorizar: PATCH confirmado (chips disabled mientras busy) y luego animación de
      salida hacia arriba; toast (sonner) si falla, la card no avanza
- [x] 2.4 Corregir: drag hacia abajo SOLO sobre el montón de hechas (pointer events,
      touch-action none local) y botón "Corregir última"; la card vuelve con la categoría
      preseleccionada y re-PATCH al cambiar; Escape cierra; prefers-reduced-motion → fades
- [x] 2.5 Estado final: resumen "N categorizados" + cierre con un único `router.refresh()`
- [x] 2.6 Montar desde `Dashboard` cuando `uncategorized.length > 0`; `Dashboard` deriva
      `triageOpen`, conserva `dismissed` hasta la próxima carga y no monta
      `CategorizationAutoRefresh` mientras el triage está abierto

## 3. Verificación

- [x] 3.1 `pnpm typecheck` y tests (`node --test`) en verde
- [x] 3.2 Probar con Playwright en escritorio (~1440px) y móvil (~375px), dark y light:
      categorizar, corregir, cerrar a medias, terminar el stack; sin scroll horizontal; teclado,
      Escape, focus trap/restauración y scroll lock
- [x] 3.3 Verificar que presupuestos y lista reflejan las categorías tras cerrar el triage
