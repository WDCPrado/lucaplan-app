## 1. Port y dominio

- [ ] 1.1 `findPeriodTransaction` en `RecurringTemplateRepository` pasa a devolver también si el
      movimiento del período es manual (sin `externalId`): es lo que distingue la marca del usuario
      de un cobro del banco, y de ahí salen tanto el "deshacer" como la precedencia del correo.
- [ ] 1.2 `markPeriodPaid(templateId, periodKey)` y `unmarkPeriodPaid(templateId, periodKey)` en el
      port. Dejar escrito en el comentario por qué el criterio es `externalId` y cuál es su techo
      (si algún día un importado pudiera venir sin él, toca la columna explícita).
- [ ] 1.3 Error de negocio para deshacer un cobro que vino del banco (→ 422).

## 2. Use-cases

- [ ] 2.1 `markRecurringPeriodPaid(deps, userId, { id, paid }, today)` en `recurring-use-cases.ts`:
      valida ownership, rechaza plantilla pausada o finalizada, deriva el `periodKey` del día, y con
      `paid: true` materializa el período (idempotente) antes de confirmarlo.
- [ ] 2.2 Con `paid: false` devuelve el movimiento a `pending`; si el del período tiene `externalId`,
      lanza el error de 1.3 sin tocar nada.

## 3. Infraestructura

- [ ] 3.1 `markPeriodPaid` / `unmarkPeriodPaid` en `recurring.infrastructure.ts`: cambian el
      `status` del movimiento del período, sin tocar monto, fecha ni categoría.
- [ ] 3.2 `attachImportedMovement`: cuando el período está confirmado **sin** `externalId`, borrar
      esa ejecución y adoptar el importado — dentro de la misma transacción que ya usa el método.
      Con `externalId` sigue devolviendo `false`.

## 4. API

- [ ] 4.1 `PATCH /api/recurring/[id]` acepta `{ periodPaid: boolean }`, con el mismo criterio de
      cuerpo mínimo que ya usa `{ isActive }`.

## 5. UI

- [ ] 5.1 `RecurringDTO` gana `currentPeriodPaidManually`, derivado de lo que ahora devuelve
      `findPeriodTransaction`.
- [ ] 5.2 `recurring-view.tsx`: acción en la fila de las activas y vigentes — marcar pagado cuando
      el período no está cobrado; deshacer cuando lo está **a mano**. Un cobro del banco muestra
      "Cobrado" sin acción, como hoy.
- [ ] 5.3 `recurring-modal.tsx`: la misma acción dentro del modal de la plantilla, llamando al mismo
      endpoint.
- [ ] 5.4 Respetar el sistema de diseño: primitivos shadcn, `AlertDialog` si la acción destructiva
      lo pide, targets ≥44px y sin hardcodear tokens.

## 6. Tests

- [ ] 6.1 `recurring.test.ts`: marcar pagado sobre un período con comprometido y sobre uno sin
      materializar; deshacer; deshacer un cobro del banco (rechaza); plantilla pausada y finalizada
      (rechazan).
- [ ] 6.2 Reemplazo por correo: el cargo importado pisa la marca manual y el período queda con un
      único movimiento, con el monto y la fecha del banco; y un período confirmado por el banco no
      se pisa.
- [ ] 6.3 Verificar los tests por mutación: romper a propósito el criterio de `externalId` y
      comprobar que se ponen en rojo.

## 7. Verificación y entorno de PR

- [ ] 7.1 `pnpm lint && pnpm typecheck && node --test "arch/**/*.test.ts"` en verde.
- [ ] 7.2 Escena `scripts/seed-pr/escenas/wdc-84-recurrente-por-cobrar.ts` con su usuario demo: una
      recurrente activa con el comprometido del mes sin cobrar (para marcarla) y otra ya marcada a
      mano (para deshacerla).
