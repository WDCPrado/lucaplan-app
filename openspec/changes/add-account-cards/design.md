## Context

Las cuentas se muestran hoy como tarjetas en el dashboard (`components/finance/account-card.tsx`):
fondo de color plano (`account.color`), y `•••• {account.id.slice(-4)}` — los últimos caracteres
del **id interno**, no un número de tarjeta real. El modelo `Account`
(`arch/v1/domain/finance/finance.domain.ts`) tiene `id, userId, bankId, name, accountType,
currency, balance, overdraftLimit, color`; no hay número de tarjeta ni arte por banco. Los bancos
son entidades (`Bank { id, userId, name }`) creadas por nombre en `create-account-use-case.ts`.

La referencia visual (imagen del usuario) es una tarjeta con arte del banco de fondo y, encima,
saldo/cupo, `•••• 8821` y el tipo. `public/` está vacío (solo `.gitkeep`).

## Goals / Non-Goals

**Goals:**
- Guardar y mostrar los **últimos 4 dígitos** reales de la tarjeta (obligatorio para débito/crédito).
- Arte de tarjeta por (banco, tipo) desde un catálogo estático en `public/`, con fallback.
- Rediseñar `AccountCard` al estilo de la referencia (arte de fondo + overlay dinámico).
- Preview de la tarjeta en el modal al elegir banco/tipo.

**Non-Goals:**
- No guardar el número completo de tarjeta (solo 4 dígitos).
- No subir imágenes desde la app (catálogo estático; buckets + tabla es trabajo futuro).
- Ahorro/billetera sin tarjeta por ahora.

## Decisions

### 1. `cardLast4` en el dominio + DB, validado en la aplicación

Agregar `cardLast4: string | null` a `Account` y `NewAccount`, y a `CreateAccountInput`. En DB,
`financial_account.cardLast4 String?` (nullable) — **nueva migración Prisma**. La obligatoriedad
por tipo se valida en `create-account-use-case.ts` (no como NOT NULL en DB, porque depende del
tipo): si `accountType ∈ {checking, credit_card}` y falta un `cardLast4` de 4 dígitos → error de
dominio.

- **Por qué nullable en DB + validación en app:** la obligatoriedad es condicional al tipo; una
  columna NOT NULL global rompería ahorro/billetera. La regla de negocio vive en el use-case
  (capa correcta), no en el esquema.
- **Solo 4 dígitos:** el input de UI acepta lo que el usuario pegue pero se persiste
  `slice(-4)` tras validar que sean 4 dígitos numéricos. Nunca se guarda el PAN completo.

### 2. Resolución del arte: `(banco-slug, cardVariant) → ruta` por convención, con fallback

Un helper puro `lib/bank-cards.ts` resuelve la ruta:
`/imagenes/bancos/{bankSlug}/{variant}.{ext}` donde `variant` = `debito` (checking) | `credito`
(credit_card). `bankSlug` se deriva del nombre del banco con un **mapa explícito**
(`"Banco de Chile" → "banco-chile"`, etc.); nombres no mapeados → `null` → fallback. El catálogo
declara qué (banco, variante) tienen imagen; si no, `AccountCard` usa el color plano actual.

- **Por qué un mapa explícito y no slugify ciego:** controla exactamente qué bancos tienen arte y
  evita rutas 404 por acentos/variantes. La forma `{ bankSlug: { debito, credito } }` es la misma
  que tendrá la futura tabla `bank × card_type → url`, así que migrar a bucket es cambiar la fuente
  del resolvedor, no la UI.
- **Alternativa considerada:** guardar la url de imagen en la cuenta. Descartada: acopla el dato a
  la presentación; el arte debe derivarse de (banco, tipo), no persistirse por cuenta.

### 3. `AccountCard` = arte de fondo + overlay dinámico

`AccountCard` renderiza la imagen (si existe) con `next/image` (fill, `object-cover`) y encima un
overlay legible (gradiente oscuro + texto): banco, saldo/cupo, `•••• {cardLast4}`, badge de tipo.
Si no hay imagen → fondo de color (`account.color`) como hoy. El `AccountDTO` expone `cardLast4`,
`bankName`, `accountType` (ya presentes salvo `cardLast4`); el resolvedor de arte corre en la UI.

- **Por qué `next/image` con assets locales:** son estáticos en `public/`, optimizados por Next,
  sin config de dominios remotos. Migrar a bucket luego cambia el `src`, no el componente.

### 4. Preview en el modal reutiliza `AccountCard`

`account-modal.tsx` muestra un `AccountCard` de preview alimentado por el estado del formulario
(banco, tipo, saldo, últimos 4). El campo "últimos 4 dígitos" se renderiza **solo** para tipos con
tarjeta (`checking`/`credit_card`) y bloquea el submit si falta o no son 4 dígitos.

## Risks / Trade-offs

- **Imágenes de marca de terceros** (tarjetas de Banco de Chile obtenidas de la web) → sólo arte
  de referencia en desarrollo; el dueño asume la decisión. Mitigación: el sistema funciona con
  fallback aunque el asset no exista, así que se puede reemplazar/eliminar sin romper nada.
- **Assets faltantes / 404** → mitigado por el fallback a color plano; el resolvedor sólo devuelve
  ruta para (banco, variante) declarados en el catálogo.
- **Contraste del texto sobre imágenes variables** → overlay con gradiente oscuro fijo para
  garantizar legibilidad independientemente del arte.
- **Migración de datos** → `cardLast4` nullable; las cuentas existentes quedan sin número (ninguna
  hoy). Sin backfill necesario.

## Migration Plan

1. Dominio: `cardLast4` en `Account`/`NewAccount`/`CreateAccountInput`.
2. Prisma: columna `cardLast4 String?` + migración (`prisma migrate diff` → archivo → `deploy`).
3. Infra + `finance-read` DTO + validación en `create-account-use-case`.
4. `lib/bank-cards.ts` (mapa banco→slug + resolvedor + variante por tipo).
5. `AccountCard` (arte + overlay + last4) y `account-modal` (campo + preview).
6. Assets: `public/imagenes/bancos/banco-chile/{debito,credito}.*`.
7. Rollback = revertir commits; la columna nullable no afecta datos existentes.

## Open Questions

- Extensión/relación de aspecto de las imágenes (¿`.webp` 16:10?). Asunción: se normaliza al
  colocarlas; el resolvedor tolera la extensión declarada en el catálogo.
- Slug de bancos aún sin arte (Santander, BICE, etc.): quedan en fallback hasta que se agreguen
  sus imágenes al catálogo.
