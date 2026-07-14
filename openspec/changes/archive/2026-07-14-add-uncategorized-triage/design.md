## Context

Los movimientos llegan por sync del scraper Banco de Chile y una IA los categoriza en segundo
plano; los que quedan `categoryId = null` hoy solo se descubren en la lista. Existen ya:

- `PATCH /api/transactions/[id]/category` (setCategory, permitido en cuentas conectadas).
- `TransactionSearchFilters` + `searchByUser` (Prisma) para búsquedas cross-mes.
- `ResponsiveModal` (dialog escritorio / drawer vaul móvil), chips de categoría en
  `transaction-modal.tsx`, patrón de drag con pointer events + haptics en el carousel del
  dashboard. Sin librería de animación (y no se agrega).

## Goals / Non-Goals

**Goals:**

- Detectar movimientos sin categoría en cada carga del dashboard (todos los meses).
- Triage en stack de cards: ver el detalle, elegir categoría, persistir al instante.
- Animación: la card categorizada vuela hacia arriba a un montón de "hechas"; arrastrar hacia
  abajo recupera la última para corregirla.
- Responsive (~1440px y ~375px), targets ≥44px, animaciones con CSS transforms.

**Non-Goals:**

- No se re-ejecuta la IA desde aquí (el triage es manual).
- No hay "descartar transacción" ni crear categorías desde el stack (para eso está el modal
  de categoría existente).
- No se persiste el progreso del stack en DB: la fuente de verdad es `categoryId`; lo hecho
  desaparece del stack en la próxima carga por sí solo.

## Decisions

1. **Query por filtro, no método nuevo**: `TransactionSearchFilters` gana
   `uncategorized?: boolean`. El repo Prisma traduce ese flag al criterio COMPLETO en el
   `where` (`categoryId: null`, `status ∉ {reversed, duplicated}`, `isInternal: false`) para
   que el tope no se consuma con filas inelegibles. Alternativa descartada: método
   `listUncategorizedByUser` dedicado — más superficie de port para lo mismo.
2. **Criterio de elegibilidad** (mismo del categorizador IA + internos): `categoryId = null`,
   `status ∉ {reversed, duplicated}` (pending SÍ entra, igual que en la IA), `isInternal =
   false`. Ordenadas por fecha desc. Tope 50 por carga: se leen 51 y si llegan más de 50 la
   UI muestra "hay más pendientes" (el repo no expone count; leer N+1 lo evita).
3. **Datos por server component**: `app/dashboard/page.tsx` llama la nueva lectura
   `listUncategorized(deps, userId)` en el mismo `Promise.all` y pasa `uncategorized` como prop
   a `Dashboard`. Sin endpoint GET nuevo ni fetch en cliente (regla: datos iniciales →
   server component).
4. **Superficie**: contenido full-screen propio montado sobre el `Dialog` existente (no
   `ResponsiveModal`): conserva portal, `aria-modal`, nombre accesible, focus trap/restauración,
   fondo inerte y bloqueo de scroll, pero evita el drawer de vaul que captura el drag vertical.
   `Dashboard` deriva `triageOpen` cuando `uncategorized.length > 0` y no está descartado; al
   cerrar no reaparece hasta la próxima carga (sin persistencia extra: recargar la app = volver a
   mostrar si quedan).
5. **Card**: contenido tipo `ConnectedDetail` compacto (monto con signo/color, descripción,
   banco · tarjeta, fecha, chips de categoría filtrados por dirección). Al elegir chip se
   PERSISTE PRIMERO (chips deshabilitados mientras `busy`); la animación de salida arranca al
   resolver OK (imperceptible en red normal). Si falla: toast de error (sonner) y la card
   sigue al frente. Sin cola optimista ni rollback — más simple y sin estados cruzados.
6. **Animación con CSS transforms + pointer events** (patrón ya usado en el carousel):
   - Stack: las 2–3 cards siguientes se ven detrás con `scale`/`translateY` decrecientes.
   - Categorizar: `translateY(-120%) rotate(±4deg)` con transition de salida; la card pasa a
     un montón superior (contador + mini-pila visual).
   - **Corregir** (no "deshacer": la categoría elegida queda persistida): drag hacia abajo
     SOLO sobre el montón de hechas (`touch-action: none` local al montón, no a la card — no
     pelea con el tap de chips ni su scroll-x) o botón "Corregir última"; la card vuelve al
     frente con su categoría marcada y elegir otra re-persiste.
   - `router.refresh()` una sola vez al cerrar/terminar el triage (no por card): evita
     re-renders del dashboard bajo el overlay en plena animación.
   - Escape cierra el overlay; con `prefers-reduced-motion` las transiciones se reducen a
     fades cortos.
7. **Al terminar** (stack vacío): estado de cierre con resumen ("N categorizados") y botón
   listo → `router.refresh()` para que presupuestos/lista reflejen las categorías nuevas.
8. **Concurrencia y transición de proveedor**:
   - La categorización de IA usa una escritura atómica condicional (`WHERE id = ? AND
     categoryId IS NULL`); si el usuario ya eligió, la IA no sobrescribe su categoría.
   - Mientras `triageOpen`, `Dashboard` no monta `CategorizationAutoRefresh`; así el legado de
     Fintoc no hace `router.refresh()` bajo el overlay. El triage sigue siendo agnóstico al
     proveedor y no depende de terminar `replace-fintoc-with-bancochile-scraper`.

## Risks / Trade-offs

- [La IA de categorización puede correr en paralelo] → la escritura condicional hace que la
  elección manual gane sin versionado/409. El auto-refresh legado se pausa mientras el triage está
  abierto para no reemplazar sus props a mitad de una interacción.
- [El endpoint no valida lado categoría↔dirección en servidor] → comportamiento preexistente
  del PATCH que ya usa el modal; los chips filtran por dirección en UI. Fuera de alcance.
- [50 tope] → se leen 51: si llegan >50 la UI muestra "hay más pendientes"; al recargar
  aparecen los siguientes.
- [Usuario con cero categorías del lado] → CTA que cierra el triage y abre el `CategoryModal`
  existente del dashboard; el triage reaparece en la próxima carga con las categorías nuevas.
- [Índice para la query] → `transaction` ya tiene `@@index([categoryId])` (los NULL se
  indexan en Postgres); volumen personal (~miles de filas): no se agrega índice compuesto.

## Open Questions

- Ninguna bloqueante. (Si molesta que aparezca en cada carga, un futuro ajuste puede
  recordar el descarte en `localStorage` por N horas — fuera de alcance.)
