## Why

Hoy los movimientos importados de Fintoc llegan **sin categoría**: hay que clasificarlos a mano uno
por uno. En la primera conexión eso puede ser cientos de movimientos. Queremos que una IA los
categorice automáticamente —tanto en la primera conexión (todo el histórico traído) como en cada
sincronización posterior (solo lo nuevo)—, respetando la regla de lado (una categoría de ingreso solo
a un crédito, una de gasto solo a un débito). Para que la IA acierte, cada categoría podrá llevar una
**descripción opcional** que se envía como contexto.

## What Changes

- **Categoría con descripción opcional**: nuevo campo `description` (texto libre, opcional) en la
  categoría. Se usa como contexto para la IA y se edita en el modal de categoría. No afecta ningún
  cálculo financiero.
- **Proveedor de IA = OpenAI (por ahora), detrás de un adapter**: adapter que llama a la API de
  **OpenAI** (Chat Completions) configurado por `OPENAI_API_KEY` y `OPENAI_MODEL`. Vive detrás de un
  **port** (`CategorizationProvider`), así que cambiarlo a otro proveedor luego es reemplazar el
  adapter, sin tocar la aplicación. **Server-only**: la key nunca llega al cliente. Si no está
  configurado, la categorización se **omite** silenciosamente (los movimientos quedan sin categoría
  para clasificar a mano).
- **Categorización automática al importar**: tras importar movimientos, se categorizan los que
  queden **sin categoría**. Primera conexión → categoriza todo el histórico traído; sync/webhook
  posterior → solo los nuevos. La IA solo puede elegir entre las categorías del **mismo lado** que el
  movimiento (income ↔ crédito, expense ↔ débito); el id devuelto se valida contra ese conjunto.
- **Loader de primera conexión hasta el primer lote categorizado**: el overlay de carga permanece
  hasta que aparezcan los primeros movimientos **importados y categorizados**, aunque el resto siga
  sincronizándose de fondo. Se agrega el paso "Categorizando con IA" a la animación.

## Capabilities

### New Capabilities
- `ai-categorization`: asignación automática de categoría a un movimiento mediante un proveedor de IA
  (OpenAI por ahora, detrás de un adapter, configurado por entorno); se ejecuta al importar (primera conexión: todo;
  sync posterior: solo lo nuevo); respeta la regla de lado (tipo de categoría ↔ dirección); se omite
  con degradación elegante si la IA no está configurada; usa la descripción de la categoría como
  contexto.

### Modified Capabilities
- `finance-model`: la categoría gana un campo `description` opcional (contexto/presentación; no entra
  en ningún cálculo).
- `bank-connection`: la sincronización, tras importar, dispara la categorización con IA de los
  movimientos sin categoría; el loader de la primera conexión se mantiene hasta que el primer lote
  esté importado **y** categorizado.

## Impact

- **Dominio** (`arch/v1/domain/finance`): `Category`/`CategoryInput` + `description`; nuevo port
  `categorization.port.ts` (`CategorizationProvider`).
- **Aplicación** (`arch/v1/application/finance-use-cases`): nuevo `categorize-movements-use-case.ts`;
  `sync-link-use-case.ts` invoca la categorización tras importar; `finance-read.ts` expone
  `description` en `CategoryDTO`.
- **Infraestructura**: nuevo adapter `arch/v1/infrastructure/http/ai/openai-categorization.provider.ts`
  (fetch a la API de OpenAI con salida JSON estructurada); repos Prisma agregan `description`.
- **Presentación/UI**: `POST /api/categories` acepta/devuelve `description`; `category-modal.tsx`
  suma el campo; `connect-bank-button.tsx` + `bank-sync-overlay.tsx` esperan/animan hasta el primer
  lote categorizado (nuevo endpoint de estado de conexión).
- **DB**: migración Prisma añadiendo `Category.description` (nullable).
- **Entorno**: nuevas variables `OPENAI_API_KEY` y `OPENAI_MODEL` (server-only).
