## Context

La categorización IA ya corre al importar (`categorize-movements-use-case.ts`): agrupa por lado,
manda lotes de 100 al provider OpenAI con las categorías del usuario (nombre + descripción) y un
catálogo fijo de comercios chilenos como pista. La asignación manual pasa por
`categorize-transaction-use-case.ts` (`PUT /api/transactions/:id/category`), invocado desde
`transaction-modal.tsx` y `uncategorized-triage.tsx`. Nada de eso recuerda las decisiones del
usuario: recategorizar no deja huella y la siguiente pasada repite el error.

## Goals / Non-Goals

**Goals:**

- Registrar cada corrección manual (texto del movimiento → categoría + nota "porqué") como memoria
  persistente por usuario.
- Preguntar el porqué al recategorizar (opcional) y ofrecer propagar la categoría a los movimientos
  con el mismo texto.
- Inyectar dinámicamente las correcciones relevantes (exactas y parecidas) al prompt del
  categorizador en cada pasada.
- Funcionar con cualquier banco/país: aprende de los datos del usuario, no de listas fijas.
- Degradación elegante: sin correcciones todo funciona igual; un fallo del registro/retrieval nunca
  rompe la asignación ni la sincronización.

**Non-Goals:**

- Embeddings/búsqueda semántica con pgvector (escalón futuro si el matching por tokens queda corto).
- Re-categorizar retroactivamente todo el histórico cuando se crea una corrección (solo se ofrece la
  propagación explícita a mismos textos; una pasada retroactiva masiva se evaluará aparte).
- Compartir aprendizaje entre usuarios (la memoria es estrictamente por usuario).
- Audit-log completo de cada recategorización: el histórico útil es la corrección **vigente** por
  texto (`updatedAt` registra la última); un log de eventos no aporta a la categorización.

## Decisions

### 1. Entidad `CategorizationCorrection`, upsert por (usuario, dirección, texto normalizado)

Tabla `categorization_correction`: `id`, `userId`, `direction` (`debit`|`credit`), `normalizedText`,
`sampleText` (descripción original de ejemplo, para mostrar en UI/prompt), `categoryId` (FK →
`category`, `onDelete: Cascade`), `note String?` (el porqué), `createdAt`, `updatedAt`.
`@@unique([userId, direction, normalizedText])`, índice `[userId, direction]`.

- **Por qué la dirección en la clave:** el mismo texto puede aparecer como débito (compra) y crédito
  (reembolso, ej. `MERPAGO *FALABELLA`); son correcciones distintas y respetan la regla de lado.
- **Por qué upsert y no historial de filas:** si el usuario cambia de opinión, la corrección nueva
  reemplaza a la vieja; dos correcciones contradictorias del mismo texto confundirían a la IA.
- **Cascade con la categoría:** borrar una categoría invalida sus correcciones; se van con ella.

### 2. Normalización determinista compartida

Función pura `normalizeMovementText` en `categorization-learning.domain.ts`: trim → mayúsculas →
sin tildes → colapsar espacios → remover secuencias de 4+ dígitos y fechas `dd/mm` (número de
operación, últimos 4 de tarjeta, montos y fechas varían entre operaciones del mismo comercio).
La misma función se usa al registrar, al contar/propagar mismos textos y en el retrieval — si no
comparten normalización, el matching exacto se rompe en silencio.

### 3. Captura en dos pasos: registro automático + follow-up opcional

`categorizeTransaction` (asignación manual) **registra la corrección automáticamente** (best-effort:
un fallo del registro no impide asignar la categoría) y la respuesta incluye `sameTextCount` (otros
movimientos del usuario con el mismo texto normalizado y dirección, excluido el editado). Asignar
`null` (quitar categoría) NO registra ni borra correcciones.

La UI muestra entonces un follow-up liviano: input corto "¿Qué es este movimiento?" (opcional,
skippable) + si `sameTextCount > 0`, botón "Aplicar a los N movimientos con esta descripción".
Ambas cosas van en un solo request nuevo: `POST /api/categorization/corrections`
`{ transactionId, note?, applyToSameText? }`.

- **Por qué dos requests:** el conteo N se conoce recién al asignar; el follow-up es opcional y no
  debe bloquear la asignación (que ya quedó persistida).
- **Por qué la nota es opcional:** obligarla en cada recategorización mata el flujo (sobre todo el
  triage de a decenas); la corrección texto→categoría vale por sí sola, la nota la enriquece.

### 4. Propagación explícita, no automática

Aplicar a mismos textos es una acción del usuario con el conteo visible (puede pisar categorías ya
asignadas en esos movimientos — por eso se confirma, no se hace sola). Opera sobre movimientos del
usuario con igual `normalizedText` y `direction`; la regla de lado queda garantizada porque la
categoría ya validó lado contra el movimiento original y los demás comparten dirección.

### 5. Retrieval en código de aplicación (sin extensiones ni embeddings)

Antes de cada pasada, el use-case carga **todas** las correcciones del usuario del lado
correspondiente (serán decenas–cientos; cabe en memoria sin drama) y por lote calcula:

- **Exactas:** mapa `normalizedText → corrección`; toda corrección cuyo texto coincida con algún
  movimiento del lote se inyecta SIEMPRE.
- **Parecidas:** similitud de conjuntos de tokens (tokens significativos de ≥3 caracteres del texto
  normalizado; coeficiente de Dice con umbral inicial 0.5, ajustable en código); top-K por
  movimiento.
- **Tope:** máximo ~30 correcciones por prompt, exactas primero, luego parecidas por score
  descendente. Evita que el prompt crezca sin límite con usuarios muy correctores.

**Alternativas descartadas:** `pg_trgm` (extensión Postgres; útil si las correcciones llegan a
miles — escalón siguiente), embeddings + pgvector (semántica real pero infra y costo nuevos —
escalón futuro). `// ponytail: token overlap en memoria; pg_trgm si las correcciones crecen a miles`.

### 6. Todo pasa por la IA — la coincidencia exacta NO se aplica determinísticamente

Decisión explícita del usuario: incluso el match exacto se inyecta al prompt (con instrucción
imperativa "coincidencia exacta ⇒ usa esa categoría") en vez de asignarse por código. Razón: el
mismo contexto inyectado generaliza a movimientos **parecidos** del lote que no comparten el texto
literal, y queda un solo camino de código. La salida se valida contra el conjunto permitido como
siempre (la IA nunca puede cruzar de lado). Trade-off asumido: costo/latencia iguales y una
desobediencia puntual del modelo es posible; mitigada por la instrucción imperativa.

### 7. Port retrocompatible

`CategorizationProvider.categorize({ movements, categories, corrections? })` con
`corrections: { text, note, categoryId }[]` ya filtradas/relevantes (el retrieval es del use-case;
el provider solo formatea). El adapter OpenAI mapea `categoryId` a las claves cortas existentes
(`c0..cN`) y arma la sección `CORRECCIONES DEL USUARIO` del prompt con `{texto, categoria, nota}`.

## Risks / Trade-offs

- **Crecimiento del prompt** → tope de correcciones por prompt (~30), exactas priorizadas.
- **Corrección obsoleta o contradictoria** → upsert (la última gana) + cascade al borrar categoría.
- **La propagación pisa categorías de otros movimientos** → acción explícita con conteo visible;
  nunca automática.
- **La nota viaja al proveedor de IA** → mismo perfil de privacidad que las descripciones de
  categoría ya existentes (texto del usuario, server-only); se documenta en la política vigente.
- **Umbral de similitud mal calibrado** (falsos parecidos) → la corrección parecida es *pista*, no
  orden; la IA puede ignorarla; umbral en una constante para ajustar con datos reales.

## Migration Plan

1. Migración Prisma aditiva: tabla `categorization_correction` (sin backfill).
2. Deploy: sin variables nuevas; sin correcciones registradas el comportamiento es idéntico al actual.
3. Rollback: quitar el wiring (registro + retrieval); la tabla es inocua y puede quedarse.

## Open Questions

1. **¿Follow-up del porqué también en el triage?** El triage es un flujo rápido de a decenas;
   propuesta: en triage la corrección se registra silenciosa (sin nota, sin interrumpir el ritmo) y
   el porqué + propagación solo se preguntan en el modal de transacción. ¿O también un campo
   discreto en la tarjeta del triage?
2. **¿La propagación debería incluir movimientos ya categorizados a mano?** Propuesta: sí (mismo
   texto = mismo comercio y el usuario confirma viendo el conteo), pero se puede restringir a
   sin-categoría + categorizados-por-IA si se prefiere conservador.
