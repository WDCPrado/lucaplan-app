## 1. Dominio + persistencia

- [x] 1.1 Agregar `cardLast4: string | null` a `Account` y `NewAccount` en `finance.domain.ts` (+ helpers `accountHasCard`, `cardVariant`, `CARD_ACCOUNT_TYPES` y error `CardLast4RequiredError`)
- [x] 1.2 `create-account-use-case.ts`: `cardLast4?` en `CreateAccountInput`; normaliza a 4 dígitos y exige (obligatorio) para `checking`/`credit_card`, nulo para el resto (→ `CardLast4RequiredError`)
- [x] 1.3 Prisma: `cardLast4 String?` en `FinancialAccount`
- [x] 1.4 Migración `20260709130000_account_card_last4` (via `migrate diff` → archivo → `migrate deploy`) aplicada; `prisma generate`
- [x] 1.5 Infra `finance.infrastructure.ts`: `toAccount` lee `cardLast4`; `create` lo guarda

## 2. Lectura / DTO

- [x] 2.1 `finance-read.ts`: `cardLast4` en `AccountDTO` + mapeo en `listAccounts`

## 3. Resolvedor de arte de tarjeta

- [x] 3.1 `lib/bank-cards.ts`: mapa `banco → slug`, `variantForType` (checking→debito, credit_card→credito), catálogo y `resolveCardArt` (fallback null)
- [x] 3.2 `lib/bank-cards.test.ts` — 4 casos (banco con arte, sin arte→null, tipo sin tarjeta→null): **pasan**

## 4. Assets del catálogo

- [x] 4.1 `public/imagenes/bancos/banco-chile/bch.png` — isotipo del banco (lo aportó el usuario). Enfoque final: NO usar una imagen de tarjeta completa, sino nuestro estilo (gradiente por variante) + el isotipo como marca de agua de fondo. El catálogo `{ banco: icono }` es la forma de la futura tabla banco→url

## 5. UI de la tarjeta

- [x] 5.1 `account-card.tsx`: gradiente por variante (azul débito / negro crédito) + isotipo del banco teñido de blanco como marca de agua de fondo + overlay con banco, saldo, `•••• {cardLast4}` real y badge de tipo; fallback a color plano
- [x] 5.2 Firma de `AccountCard` sin cambios (`{ account, hidden }`) → el grid del dashboard lo usa igual, sin ajustes

## 6. Modal de crear cuenta

- [x] 6.1 `account-modal.tsx`: campo "últimos 4 dígitos" (numérico, máx 4) visible y obligatorio solo para `checking`/`credit_card`; bloquea submit si falta o no son 4. Route `/api/accounts` reenvía `cardLast4`; error mapeado a 422 en `finance-http.ts`
- [x] 6.2 Preview en vivo: `AccountCard` alimentado por el estado del formulario, reacciona al elegir banco/tipo/dígitos

## 7. Verificación

- [x] 7.1 `pnpm typecheck` y `pnpm lint` sin errores (2 warnings ajenos preexistentes); tests dominio+resolvedor: 16/16 pasan
- [x] 7.2 Verificado con Playwright (via el mock `desktop-shell` que monta el `AccountModal` real): corriente→arte débito azul + campo; crédito→arte negro + `•••• 8821`; ahorro→sin campo, fallback color. Screenshots mostrados al usuario
