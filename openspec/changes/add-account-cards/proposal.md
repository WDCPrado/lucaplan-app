## Why

Hoy las tarjetas de cuenta en el dashboard muestran `•••• {id.slice(-4)}` (los últimos 4
caracteres del **id interno**), lo que no significa nada para el usuario, y su fondo es solo un
color plano. Una app de finanzas se siente real cuando cada cuenta se ve como su **tarjeta
física**: el número real (últimos 4 dígitos), el arte del banco y el tipo (débito/crédito).
Esto acerca la UI a la referencia visual aprobada (tarjeta con logo del banco, cupo/saldo,
`•••• 8821`, "Crédito").

## What Changes

- **Nuevo dato en la cuenta: últimos 4 dígitos de la tarjeta** (`cardLast4`). Solo se guardan
  los 4 dígitos (nunca el número completo). Es **obligatorio** para las cuentas con tarjeta:
  **cuenta corriente** (= tarjeta de débito, se asume) y **crédito**. Ahorro y billetera **no
  tienen tarjeta** por ahora (sin campo, sin arte).
- **Mostrar los últimos 4 dígitos reales** en la tarjeta (`•••• 8821`) en vez de `id.slice(-4)`.
- **Arte de tarjeta por banco + tipo** desde un catálogo estático en `public/`: cada cuenta con
  tarjeta usa una imagen de fondo resuelta por (banco, tipo). Estructura:
  `public/imagenes/bancos/<banco-slug>/<debito|credito>.<ext>`. Primer banco poblado: **Banco de
  Chile** (débito y crédito). Bancos/tipos sin imagen caen a un **fallback** (color plano actual).
- **Rediseño de la tarjeta** (`AccountCard`) al estilo de la referencia: imagen de arte de fondo
  + overlay con datos dinámicos (nombre/logo del banco, saldo o cupo, `•••• last4`, badge de
  tipo). El saldo y los 4 dígitos son dinámicos por cuenta; la imagen es solo el arte.
- **Preview en el modal de crear cuenta**: al elegir banco + tipo, se muestra la tarjeta con el
  arte correspondiente en vivo; el campo "últimos 4 dígitos" aparece y es obligatorio cuando el
  tipo tiene tarjeta.
- La estructura de carpetas del catálogo se piensa para **migrar luego a un bucket + tabla**
  (banco × tipo → url de imagen); por ahora es estática en `public/` y resuelta por convención.

Fuera de alcance: no se guarda el número completo de tarjeta (solo 4 dígitos); no hay subida de
imágenes por el usuario (catálogo estático); ahorro/billetera sin tarjeta por ahora.

## Capabilities

### New Capabilities

- `account-card`: La representación visual de una cuenta como tarjeta bancaria — resolución del
  arte por (banco, tipo) desde un catálogo estático con fallback, y la presentación de la tarjeta
  (arte de fondo + overlay con saldo/cupo, últimos 4 dígitos y badge de tipo).

### Modified Capabilities

- `finance-model`: La cuenta gana el atributo **últimos 4 dígitos de tarjeta** (`cardLast4`),
  obligatorio para los tipos con tarjeta (`checking` = débito, `credit_card` = crédito) y ausente
  para los tipos sin tarjeta (`savings`, `wallet`).

## Impact

- **Dominio** (`arch/v1/domain/finance/finance.domain.ts`): `Account` y `NewAccount` ganan
  `cardLast4: string | null`.
- **Aplicación**: `create-account-use-case.ts` valida `cardLast4` (4 dígitos) obligatorio para
  tipos con tarjeta; `finance-read.ts` expone `cardLast4` + los datos de arte (banco-slug, tipo)
  en `AccountDTO`.
- **Infraestructura**: `financial_account` gana la columna `cardLast4` (nullable en DB, validada
  en app) — **nueva migración Prisma**. El repo guarda/lee el campo.
- **Presentación / UI**:
  - `components/finance/account-card.tsx` — rediseño con imagen de arte + overlay; usa `cardLast4`.
  - `components/finance/account-modal.tsx` — campo "últimos 4 dígitos" (obligatorio por tipo) +
    preview de la tarjeta al elegir banco/tipo.
  - Un resolvedor `banco + tipo → ruta de imagen` (con mapa banco→slug y fallback).
- **Assets**: catálogo en `public/imagenes/bancos/banco-chile/` (débito y crédito). Las imágenes
  de Banco de Chile se obtendrán de la web — **son imágenes de marca de terceros**; se usan como
  arte de referencia en desarrollo y el dueño del proyecto asume esa decisión.
- **Sin cambios** en la lógica de caja/presupuestos, auth, ni el shell.
