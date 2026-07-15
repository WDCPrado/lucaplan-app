## 1. Dominio: entidad, port y normalización

- [ ] 1.1 Crear `arch/v1/domain/finance/categorization-learning.domain.ts`: tipo
      `CategorizationCorrection` (+ input), port `CorrectionRepository`
      (`upsertByText`, `listByUserDirection`, `countSameText`, `applyCategoryToSameText`,
      `setNote`) y función pura `normalizeMovementText` (mayúsculas, sin tildes, espacios
      colapsados, sin secuencias de 4+ dígitos ni fechas `dd/mm`)
- [ ] 1.2 Extender `categorization.port.ts`: `categorize({ movements, categories, corrections? })`
      con `corrections: { text: string; note: string | null; categoryId: string }[]` (opcional,
      retrocompatible)

## 2. Base de datos

- [ ] 2.1 Modelo Prisma `CategorizationCorrection` (`categorization_correction`): userId, direction,
      normalizedText, sampleText, categoryId (FK cascade), note?, timestamps;
      `@@unique([userId, direction, normalizedText])`, `@@index([userId, direction])`
- [ ] 2.2 Migración SQL aditiva + regenerar el cliente Prisma

## 3. Infraestructura

- [ ] 3.1 Repo Prisma `categorization-correction.infrastructure.ts` implementando
      `CorrectionRepository` (el conteo y la propagación filtran por texto normalizado calculado
      con la MISMA función del dominio)
- [ ] 3.2 `openai-categorization.provider.ts`: sección `CORRECCIONES DEL USUARIO` en el prompt
      (`{texto, categoria: cN, nota}`) + instrucción en SYSTEM: coincidencia exacta ⇒ usar esa
      categoría; parecida ⇒ pista fuerte

## 4. Aplicación

- [ ] 4.1 `categorize-transaction-use-case.ts`: al asignar categoría no-null, registrar la
      corrección (upsert, best-effort con try/catch) y devolver `sameTextCount`
- [ ] 4.2 Nuevo `annotate-correction-use-case.ts`: guardar nota en la corrección del movimiento y/o
      aplicar la categoría a los movimientos con el mismo texto normalizado y dirección (validando
      ownership)
- [ ] 4.3 `categorize-movements-use-case.ts`: cargar correcciones del lado, retrieval por lote
      (exactas por mapa + parecidas por Dice de tokens ≥3 chars, umbral 0.5, top-K), tope ~30 por
      prompt (exactas primero), pasar `corrections` al provider; fallo del retrieval ⇒ categorizar
      sin correcciones

## 5. Presentación (API + UI)

- [ ] 5.1 `PUT /api/transactions/:id/category`: respuesta incluye `sameTextCount`
- [ ] 5.2 Nuevo `POST /api/categorization/corrections`: `{ transactionId, note?, applyToSameText? }`
      → invoca `annotate-correction`
- [ ] 5.3 `transaction-modal.tsx`: follow-up tras recategorizar — input corto «¿Qué es este
      movimiento?» (opcional) + botón «Aplicar a los N con esta descripción» si `sameTextCount > 0`
- [ ] 5.4 `uncategorized-triage.tsx`: registrar corrección silenciosa al asignar (sin interrumpir el
      ritmo del triage) — según Open Question 1 del design
- [ ] 5.5 Actualizar copy de la landing/sección IA solo si cambia algo del pitch (los 3 pilares ya
      están descritos)

## 6. Verificación

- [ ] 6.1 Tests `node --test`: `normalizeMovementText` (dígitos/fechas/tildes), similitud y tope del
      retrieval, upsert-reemplaza, corrección best-effort (registro que falla no bloquea), inyección
      de `corrections` al provider (fake) y regla de lado en retrieval
- [ ] 6.2 `pnpm typecheck` y `pnpm lint` sin errores
- [ ] 6.3 Prueba en vivo: recategorizar un movimiento real, verificar corrección en BD, correr
      `sync:email`/categorización y confirmar que el mismo texto cae en la categoría corregida
