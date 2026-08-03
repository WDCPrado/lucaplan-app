## 1. Dominio

- [x] 1.1 Extraer `rankTemplatesFor(movement, templates): RecurringTemplate[]` en `recurring.domain.ts` con la lógica de orden actual (filtro por `matchesTemplate`, luego rango más estrecho, luego monto más cercano)
- [x] 1.2 Reescribir `pickTemplateFor` como `rankTemplatesFor(movement, templates)[0] ?? null`

## 2. Aplicación

- [x] 2.1 `confirmFromMovement`: iterar `rankTemplatesFor` en orden e intentar `attachImportedMovement` en cada candidata; devolver la primera que tome (`true`), o `null` si todas rebotan

## 3. Tests y verificación

- [x] 3.1 Test: dos plantillas idénticas (misma descripción y precio) + dos cargos del período → cada cargo vinculado a una plantilla distinta, ambos comprometidos consumidos, ninguno huérfano
- [x] 3.2 Test: una sola plantilla candidata con período ya confirmado + segundo cargo en rango → no se vincula, sigue el flujo normal
- [x] 3.3 Verificar que los tests existentes de `pickTemplateFor` siguen verdes
- [x] 3.4 Correr `pnpm lint && pnpm typecheck && node --test "arch/**/*.test.ts"` y dejar en verde
