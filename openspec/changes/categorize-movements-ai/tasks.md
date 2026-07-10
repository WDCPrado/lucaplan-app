## 1. Dominio: descripción de categoría + port de IA

- [x] 1.1 Agregar `description: string | null` a `Category` y `CategoryInput` en `finance.domain.ts`
- [x] 1.2 Crear `arch/v1/domain/finance/categorization.port.ts` con la interfaz `CategorizationProvider` (`categorize(movements, categories) => Promise<Record<movimientoId, categoryId|null>>`) y sus tipos de entrada

## 2. Base de datos

- [x] 2.1 Añadir `description String?` al modelo `Category` en `prisma/schema.prisma`
- [x] 2.2 Generar y aplicar la migración (`Category.description` nullable, aditiva) y regenerar el cliente Prisma

## 3. Infraestructura: adapter de IA

- [x] 3.1 Crear `arch/v1/infrastructure/http/ai/openai-config.ts` que lea `OPENAI_API_KEY`/`OPENAI_MODEL` (server-only, default de modelo `gpt-4o-mini`) y reporte si está configurado
- [x] 3.2 Crear `arch/v1/infrastructure/http/ai/openai-categorization.provider.ts`: `fetch` a `https://api.openai.com/v1/chat/completions` con `response_format: json_object`, prompt con movimientos + categorías candidatas, parseo defensivo del JSON, timeout (~20s), y mapa vacío ante cualquier fallo/no-config
- [x] 3.3 Propagar `description` en los mappers/repos Prisma de categoría (`finance.infrastructure.ts`: `upsert` y lectura)

## 4. Aplicación: use-case de categorización + wiring en sync

- [x] 4.1 Crear `arch/v1/application/finance-use-cases/categorize-movements-use-case.ts`: agrupa por dirección, filtra categorías por lado (income↔credit, expense↔debit), llama al provider por lotes (~40), valida que el id devuelto pertenezca al conjunto permitido y persiste con `setCategory`; ignora ids inválidos (quedan sin categoría)
- [x] 4.2 Integrar en `sync-link-use-case.ts`: tras `importMovements`, consultar los movimientos **sin categoría** de la cuenta y categorizarlos (best-effort, no aborta el sync ante fallo)
- [x] 4.3 Señal del "primer lote listo": en vez de `lastSyncedAt` se usa el conteo de movimientos/sin-categoría (más robusto: no cuelga si algo queda sin clasificar). Sync incremental (`updatedSince`) verificado intacto
- [x] 4.4 Exponer `description` en `CategoryDTO` (`finance-read.ts`)

## 5. Presentación (API + UI)

- [x] 5.1 `POST /api/categories`: aceptar y persistir `description` (opcional)
- [x] 5.2 `category-modal.tsx`: agregar textarea opcional "Descripción" (con hint de que ayuda a la IA), precargado en edición
- [x] 5.3 Crear `GET /api/fintoc/status`: devuelve `{ connected, accounts, movements, uncategorized, aiEnabled }` (para el loader)
- [x] 5.4 `connect-bank-button.tsx`: en la primera conexión, sondear `/api/fintoc/status` hasta que el primer lote esté importado y categorizado (en vez de solo contar cuentas)
- [x] 5.5 `bank-sync-overlay.tsx`: agregar el paso animado "Categorizando con IA"

## 6. Verificación

- [x] 6.1 Test del use-case (node --test): filtrado por lado, validación de id fuera de conjunto (queda sin categoría) y skip elegante con provider fake que falla
- [x] 6.2 `pnpm typecheck` y `pnpm lint` sin errores
- [x] 6.3 Prueba en vivo OK: categorización sobre movimientos reales del usuario (calidad buena: Uber Eats→Compras, Hapi→Invertir, Railway→Subscripciones, Red Movilidad→Transporte; transferencias→sin categoría). Backlog completo NO corrido (decisión del usuario).
- [x] 6.4 Actualizar `.env.example` (o doc) con `OPENAI_API_KEY`/`OPENAI_MODEL` y nota de server-only
