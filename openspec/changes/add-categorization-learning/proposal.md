## Why

El pitch de LucaPlan es "**Se ordena solo. Y aprende de ti.**" con tres pilares:

1. **Entiende el lenguaje bancario** — la IA lee la descripción cruda («Pago:payu *uber eats» es
   comida). **Ya existe** (`ai-categorization`: prompt con reglas + catálogo de comercios CL).
2. **Tus categorías explican qué son** — cada categoría lleva una descripción del usuario como
   contexto. **Ya existe** (`Category.description` inyectada al prompt).
3. **Aprende de tus correcciones** — cuando el usuario recategoriza, su elección queda guardada y
   afina las siguientes pasadas. **No existe: este change lo construye.**

Hoy una recategorización manual corrige solo ESE movimiento: el sistema no recuerda nada, el mismo
comercio vuelve a caer mal en la próxima sincronización y el conocimiento del usuario se pierde.
Además, el único conocimiento extra de comercios es un catálogo **fijo y chileno**; la memoria de
correcciones aprende de los datos del propio usuario, así que funciona con cualquier banco y país.

## What Changes

- **Memoria de correcciones (histórico por usuario)**: nueva entidad persistente
  `CategorizationCorrection`: texto normalizado del movimiento → categoría elegida + **nota "porqué"**
  (texto corto del usuario explicando qué es el movimiento). Upsert por texto: la última corrección
  del mismo texto reemplaza a la anterior.
- **Captura al categorizar a mano**: toda asignación manual de categoría (modal de transacción y
  triage) registra/actualiza la corrección automáticamente. Tras recategorizar, la UI pregunta el
  **porqué** (opcional) y, si hay otros movimientos con el **mismo texto**, ofrece aplicarles la misma
  categoría en un paso (muestra el conteo N).
- **Capa de retrieval antes de categorizar**: antes de cada pasada de IA se buscan las correcciones
  del usuario que matcheen los movimientos del lote — por **texto exacto** (normalizado) y por
  **texto parecido** (similitud de tokens) — y se **inyectan dinámicamente al prompt** del
  categorizador: exacta = instrucción de usar esa categoría; parecida = pista fuerte con la nota.
  Todo sigue pasando por la IA (decisión explícita: así una corrección también ayuda a movimientos
  parecidos que no comparten el texto literal).
- **Port extendido**: `CategorizationProvider.categorize` gana un parámetro opcional `corrections`
  (retrocompatible).

## Capabilities

### New Capabilities

- `categorization-learning`: memoria de correcciones del usuario (registro al categorizar a mano,
  nota "porqué", propagación a movimientos con el mismo texto) + retrieval de correcciones exactas y
  parecidas e inyección al categorizador IA, con normalización de texto determinista, regla de lado
  y degradación elegante.

### Modified Capabilities

- `finance-model`: nueva entidad `CategorizationCorrection` (no entra en ningún cálculo financiero).

> Nota housekeeping: el change `categorize-movements-ai` está implementado (tasks 100%) pero sin
> sync/archive, por lo que la capability `ai-categorization` aún no existe canónica. Este change no
> la modifica formalmente (la inyección se especifica dentro de `categorization-learning`); conviene
> archivar aquel change antes o junto con este.

## Impact

- **Dominio** (`arch/v1/domain/finance`): nuevo `categorization-learning.domain.ts` (entidad,
  port `CorrectionRepository`, función pura `normalizeMovementText`); `categorization.port.ts`
  suma `corrections?` al input.
- **Aplicación** (`arch/v1/application/finance-use-cases`): `categorize-transaction-use-case.ts`
  registra la corrección (best-effort) y devuelve el conteo de movimientos con el mismo texto;
  nuevo `annotate-correction-use-case.ts` (guardar nota + aplicar a mismos textos);
  `categorize-movements-use-case.ts` hace el retrieval e inyecta las correcciones por lote.
- **Infraestructura**: nuevo repo Prisma `categorization-correction.infrastructure.ts`;
  `openai-categorization.provider.ts` arma la sección "CORRECCIONES DEL USUARIO" en el prompt.
- **Presentación/UI**: `PUT /api/transactions/:id/category` devuelve `sameTextCount`; nuevo
  `POST /api/categorization/corrections` (nota + aplicar en lote); follow-up de porqué/propagación
  en `transaction-modal.tsx` y `uncategorized-triage.tsx`.
- **DB**: migración aditiva — tabla `categorization_correction` (FK a categoría con cascade).
- **Entorno**: sin variables nuevas.
