## 1. Dominio: entidad, port y normalización

- [x] 1.1 Crear `arch/v1/domain/finance/categorization-learning.domain.ts`: tipo
      `CategorizationCorrection` (+ input), port `CorrectionRepository`
      (`upsertByText`, `listByUserDirection`, `countSameText`, `applyCategoryToSameText`,
      `setNote`) y función pura `normalizeMovementText` (mayúsculas, sin tildes, espacios
      colapsados, sin secuencias de 4+ dígitos ni fechas `dd/mm`) + `selectCorrectionsForBatch`
      (exactas primero, parecidas por Dice sobre umbral, tope 30)
- [x] 1.2 Extender `categorization.port.ts`: `categorize({ movements, categories, corrections? })`
      con `corrections: { text: string; note: string | null; categoryId: string }[]` (opcional,
      retrocompatible)

## 2. Base de datos

- [x] 2.1 Modelo Prisma `CategorizationCorrection` (`categorization_correction`): userId, direction,
      normalizedText, sampleText, categoryId (FK cascade), note?, timestamps;
      `@@unique([userId, direction, normalizedText])`, `@@index([userId, direction])`
- [x] 2.2 Migración SQL aditiva (`20260715200000_add_categorization_correction`) aplicada
      (`prisma migrate deploy`) + cliente Prisma regenerado

## 3. Infraestructura

- [x] 3.1 Repo Prisma `categorization-correction.infrastructure.ts` implementando
      `CorrectionRepository` (el conteo y la propagación filtran por texto normalizado calculado
      con la MISMA función del dominio, en memoria)
- [x] 3.2 `openai-categorization.provider.ts`: sección `CORRECCIONES DEL USUARIO` en el prompt
      (`{texto, categoria: cN, nota}`) + instrucción en SYSTEM: coincidencia exacta ⇒ usar esa
      categoría (obligatorio); parecida ⇒ pista muy fuerte

## 4. Aplicación

- [x] 4.1 `categorize-transaction-use-case.ts`: al asignar categoría no-null, registrar la
      corrección (upsert, best-effort con try/catch) y devolver `{ transaction, sameTextCount }`
- [x] 4.2 Nuevo `annotate-correction-use-case.ts`: guardar nota en la corrección del movimiento y/o
      aplicar la categoría a los movimientos con el mismo texto normalizado y dirección (validando
      ownership)
- [x] 4.3 `categorize-movements-use-case.ts`: cargar correcciones del lado (filtradas al conjunto
      permitido), retrieval por lote con `selectCorrectionsForBatch`, pasar `corrections` al
      provider; fallo del retrieval ⇒ categorizar sin correcciones. Wiring en
      `categorize-pending.infrastructure.ts` y `financeDeps`

## 5. Presentación (API + UI)

- [x] 5.1 `PATCH /api/transactions/:id/category`: respuesta incluye `sameTextCount`
- [x] 5.2 Nuevo `POST /api/categorization/corrections`: `{ transactionId, note?, applyToSameText? }`
      → invoca `annotate-correction`, devuelve `{ applied }`
- [x] 5.3 `transaction-modal.tsx` (ConnectedDetail): paso de aprendizaje tras guardar — input
      «¿Qué es este movimiento?» (opcional) + botón «Aplicar a los N con esta descripción» si
      `sameTextCount > 0`, «Solo este»/«Listo» para cerrar. Los movimientos manuales editados por
      el formulario completo (PUT) quedan fuera por diseño
- [x] 5.4 `uncategorized-triage.tsx`: registro silencioso al asignar — cubierto sin cambios de UI
      (usa el mismo endpoint PATCH; el use-case registra siempre)
- [x] 5.5 Landing/sección IA: sin cambios necesarios (los 3 pilares ya están descritos)

## 6. Verificación

- [x] 6.1 Tests `node --test` (`categorization-learning.test.ts`, 11 tests): normalización
      (dígitos/fechas/montos/tildes), selección exacta/parecida y tope, inyección al provider con
      filtro de lado, retrieval caído degrada, registro best-effort, null no registra, nota +
      propagación, sin categoría no anota. Suite completa 81/81
- [x] 6.2 `pnpm typecheck` y `pnpm lint` sin errores (3 warnings preexistentes)
- [x] 6.3 Prueba en vivo (cuenta test del dev server): PATCH devuelve `sameTextCount` y revierte
      OK; repo verificado directo contra la BD (upsert reemplaza categoría conservando la nota;
      fila de prueba limpiada). NOTA: el dev server corriendo necesita REINICIO para tomar el
      cliente Prisma regenerado (el singleton viejo no conoce `categorization_correction`)
