## Context

Los movimientos de Fintoc se importan sin categoría (`sync-link-use-case.ts` → `importMovements`).
El saldo lo fija el proveedor y los movimientos son de solo lectura salvo la categoría
(`categorize-transaction-use-case.ts` ya permite asignarla a mano, validando ownership y sin tocar
el saldo). Las categorías son globales por usuario, con `type` (income/expense) que ya filtra por
lado en la UI. Queremos categorización automática por IA al importar, con una descripción opcional
por categoría como contexto, y que el loader de la primera conexión espere al primer lote
categorizado. Restricción dura del proyecto: la secret/API key nunca llega al cliente.

## Goals / Non-Goals

**Goals:**
- Categorizar automáticamente los movimientos **sin categoría** al importar (primera conexión: todo;
  sync posterior: solo lo nuevo), respetando la regla de lado (income↔credit, expense↔debit).
- Proveedor de IA = **OpenAI** (por ahora) detrás de un port/adapter, configurado por entorno
  (`OPENAI_API_KEY`/`OPENAI_MODEL`), server-only. Cambiarlo luego = otro adapter, sin tocar la app.
- Descripción opcional por categoría, usada como contexto de la IA.
- Loader de primera conexión hasta el primer lote importado **y** categorizado.
- Degradación elegante: sin IA o ante fallo, los movimientos quedan sin categoría; el import no se
  rompe.

**Non-Goals:**
- BYOK por usuario / selección de proveedor en UI (se evaluará después; ahora es env del servidor).
- Aprender de las correcciones del usuario / re-categorizar lo ya categorizado.
- Categorización en la nube con colas/workers dedicados (corre dentro del ciclo de sync actual).

## Decisions

### 1. Port `CategorizationProvider` + adapter OpenAI
Nuevo `arch/v1/domain/finance/categorization.port.ts`:
`categorize(input: { movements: {externalId, description, amount, direction}[]; categories: {id, name, type, description}[] }) => Promise<{ [movementId]: categoryId | null }>`.
Adapter en `arch/v1/infrastructure/http/ai/openai-categorization.provider.ts`: un `fetch` a
`https://api.openai.com/v1/chat/completions` con `Authorization: Bearer ${OPENAI_API_KEY}`, modelo
`OPENAI_MODEL` (default barato, p.ej. `gpt-4o-mini`), pidiendo salida JSON estructurada.
- **Por qué OpenAI directo + port:** lo pidió el usuario y es lo más simple ahora; un solo `fetch`,
  sin SDK ni dependencia nueva. El **port** es el punto de cambio: mañana se swapea por otro adapter
  (local, otro proveedor) sin tocar el use-case.
- **Alternativas descartadas:** SDK de OpenAI (dependencia innecesaria para un POST); usar la
  suscripción de ChatGPT (no hay acceso programático soportado).

### 2. La regla de lado se impone en el servidor, no se confía a la IA
El use-case agrupa los movimientos por dirección y, para cada grupo, envía **solo** las categorías
del tipo correspondiente. El id devuelto se valida contra ese conjunto; si no pertenece (o es
inválido/null), el movimiento queda sin categoría. Así la IA nunca puede cruzar ingreso↔gasto aunque
alucine. Si un lado no tiene categorías, ese grupo se omite.
- **Chunking:** lotes de ~40 movimientos por llamada para acotar tamaño de prompt y costo.

### 3. La categorización corre dentro de `syncLink`, tras `importMovements`
Después de importar los movimientos de una cuenta, se consultan los **sin categoría** de esa cuenta y
se categorizan (`transactions.setCategory`). Reusa el ciclo actual (conexión/webhook/refresco) sin
infra nueva. Un fallo de IA se traga (best-effort), igual que ya se hace con la carrera P2003.
- **Señal del loader:** `syncLink` estampa `bank.lastSyncedAt` **al terminar** import+categorización
  del primer paso. Nuevo `GET /api/fintoc/status` devuelve si el usuario ya tiene un banco conectado
  con `lastSyncedAt` seteado (y nº de cuentas). `connect-bank-button.tsx` sondea ese endpoint (en vez
  de solo contar cuentas) hasta esa señal; `bank-sync-overlay.tsx` suma el paso "Categorizando con IA".

### 4. Salida estructurada + parseo defensivo
El adapter pide `response_format: { type: "json_object" }` (OpenAI lo soporta) para forzar JSON, y aun
así valida la forma extrayendo/parseando defensivamente. Cualquier fallo (no configurado, red, JSON
inválido, timeout ~20s) ⇒ devuelve mapa vacío ⇒ movimientos sin categoría. Nunca lanza hacia arriba
en el path de sync.

### 5. Campo `description` en categoría
`Category`/`CategoryInput` + `description: string | null`; migración Prisma nullable; `POST
/api/categories` lo acepta/persiste; `CategoryDTO` lo expone; `category-modal.tsx` suma un textarea
opcional. No entra en ningún cálculo.

## Risks / Trade-offs

- **Latencia de IA bloquea el loader en la 1ª conexión** → se espera solo el primer lote; el resto
  sigue de fondo; chunking + timeout por llamada con skip elegante; el overlay muestra el progreso.
- **Categoría equivocada** → el usuario puede reasignarla a mano (ya soportado); la regla de lado
  evita el peor error (cruzar ingreso/gasto).
- **Costo/uso de tokens** → solo se categoriza lo **sin categoría**, en lotes, con modelo barato
  configurable; nunca re-categoriza.
- **Variabilidad de endpoints compatibles** (soporte de `response_format`, formato del `content`) →
  parseo defensivo por extracción de JSON, no dependemos de modo estructurado nativo.
- **API key en entorno** → server-only (`AI_*` sin `NEXT_PUBLIC_`); nunca inlined al cliente, igual
  que la secret de Fintoc.

## Migration Plan

1. Migración Prisma: `Category.description` nullable (aditiva, sin backfill).
2. Variables de entorno nuevas (`OPENAI_API_KEY`, `OPENAI_MODEL`, opcionales): sin ellas, la app
   funciona igual (sin categorización IA).
3. Rollback: quitar la llamada a categorización en `syncLink` (los movimientos vuelven a quedar sin
   categoría); la columna `description` es inocua y puede quedarse.
