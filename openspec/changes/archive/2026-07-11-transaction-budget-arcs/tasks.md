# Tasks: transaction-budget-arcs

## 1. Capa de lectura

- [x] 1.1 `finance-read.ts`: agregar `categoryLimit: number | null` (requerido) a `TransactionDTO` y **extender la firma de `txToDTO`** con el límite; llamadas: `limitById.get(...)?.toMajor() ?? null` en `listTransactions`, `limit.toMajor()` en `getCategoryDetail`, `null` en `searchTransactions`
- [x] 1.2 Actualizar los datos demo tipados como `TransactionDTO` (`app/page.tsx`, `app/design/desktop-shell/page.tsx`) con el campo nuevo

## 2. UI

- [x] 2.1 `movement-row.tsx`: cuando `remaining !== null && categoryLimit !== null`, envolver el icono en `ProgressRing` `size={44}` `stroke={3.5}` con `% = (límite − quedan)/límite` y estado por umbrales (helper local; límite 0 o restante negativo ⇒ `excedido`); sin restante/límite, círculo plano actual

## 3. Verificación y cierre

- [x] 3.1 `pnpm typecheck` + `pnpm lint` en verde
- [x] 3.2 Playwright en ~1440px y ~420px, dark + light: arcos en gastos con "Quedan" (estados bueno/moderado/excedido), ingresos y sin-categoría sin arco; screenshot final
- [x] 3.3 Linear: marcar checkboxes en `## Claude Code` de LUCA-3 y mover a Done
