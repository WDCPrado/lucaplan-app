<div align="center">

<img src="public/og-lucaplan.png" alt="Luca Plan — Tu plan, mes a mes" width="720" />

# Luca Plan

**Este mes sí tiene un plan.**

Finanzas personales, un mes a la vez. Conecta tu correo, deja que la IA categorice tus
gastos y cuadra tu presupuesto mensual — sin entregarle tus claves bancarias a nadie.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Prisma](https://img.shields.io/badge/Prisma-7-2d3748?logo=prisma)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169e1?logo=postgresql&logoColor=white)](https://www.postgresql.org)

</div>

---

![Landing de Luca Plan](docs/images/landing-hero.png)

## ¿Qué es Luca Plan?

Luca Plan es una app **open source** de planificación financiera personal, pensada para
Chile. Reúne tus cuentas, tarjetas y movimientos, los categoriza con IA y los convierte
en un plan mensual confiable: cuánto entra, cuánto reservaste y cuánto te queda para
decidir hoy.

La idea central: **cada mes parte limpio**. En vez de un saldo acumulado eterno que ya
no dice nada, Luca Plan trabaja con presupuestos que reinician contigo cada mes.

Su diferencial es cómo obtiene los datos: **se conecta a tu correo, no a tu banco**.
Los bancos ya te avisan cada compra por email; Luca Plan lee solo esas notificaciones
(permiso de solo lectura, revocable) y convierte cada aviso en un movimiento
categorizado. Nunca conoce tus claves bancarias y no puede mover tu dinero.

## Funcionalidades

### 💳 Cuentas y tarjetas, tal cual las conoces

![Componentes de la app: movimientos, presupuestos y tarjetas](docs/images/app-components.png)

- Cuentas corrientes, de ahorro, tarjetas de crédito, líneas de crédito, billeteras e
  inversiones — manuales o conectadas por correo.
- Tarjetas de crédito con **cupos separados por moneda**: cupo nacional (CLP) y cupo
  internacional (USD), cada uno con usado/disponible/límite. Nunca se mezclan monedas.
- Sobregiro/línea de crédito modelado como deuda, separado de la caja disponible.
- Carrusel de tarjetas con drag y snap (misma sensación en la landing y el dashboard).
- Conversión referencial USD→CLP con el dólar observado de [mindicador.cl](https://mindicador.cl).

### 📅 Presupuesto mensual que reinicia contigo

- Límite global del mes + límites por categoría; lo no asignado queda como "por
  presupuestar", y si te sobre-asignas la app lo avisa sin bloquearte.
- Anillos de progreso por categoría con estado visual (bien / moderado / alto) y el
  disponible restante en CLP.
- Los límites por categoría se **heredan de mes a mes** (carry-forward): configura una
  vez, ajusta cuando cambie tu vida.
- Categorías de ingreso con avance hacia tu meta mensual.
- Selector de mes para navegar tu historial; movimientos con búsqueda y filtros.

### 🤖 Categorización con IA que aprende de ti

![Categorización con IA](docs/images/ai-categorization.png)

- Entiende el lenguaje bancario crudo: `Pago:payu *uber eats` es Comida, no un misterio.
- Cada categoría lleva una **descripción tuya** que la IA usa como contexto: tú defines
  qué significa "Cuentas" en tu vida.
- Aprende de tus recategorizaciones y ofrece aplicar el cambio a los movimientos
  similares en un clic.
- Triage de movimientos sin categoría para clasificar en lote.
- Funciona con OpenAI (`gpt-4o-mini` por defecto) y se degrada con gracia: sin API key
  la app funciona igual, solo que los movimientos quedan sin categorizar.

### 📬 Conexión por correo: tu banco ya te avisa, Luca Plan escucha

![Conexión por correo](docs/images/email-connection.png)

- Hoy: **Banco de Chile** vía **Outlook** (Microsoft Graph). Gmail, próximamente.
- OAuth 2.0 con PKCE y permiso delegado **mínimo** (`Mail.Read`): Luca Plan no puede
  enviar, mover ni borrar correos.
- Solo se procesan los remitentes oficiales del banco; el resto de tu correo no se lee
  ni se guarda. De cada aviso se conserva únicamente el movimiento (monto, comercio, fecha).
- Detección automática de cuentas y tarjetas desde los propios avisos: confirmas,
  registras tus saldos iniciales y listo.
- Saldos proyectados en tiempo real desde tu último saldo confirmado; "Actualizar
  saldos" los reconcilia en un paso cuando algo no generó correo.
- Sincronización por webhook (tiempo real) o por cron; desconexión en un clic que borra
  la conexión, los movimientos importados y el token.
- El refresh token se guarda **cifrado con AES-256-GCM**; los cuerpos de correo se
  procesan en memoria y nunca se persisten.

## Stack

| Capa          | Tecnología                                                              |
| ------------- | ----------------------------------------------------------------------- |
| Framework     | [Next.js 16](https://nextjs.org) (App Router) + [React 19](https://react.dev) |
| Lenguaje      | TypeScript                                                               |
| UI            | [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) + Base UI, `lucide-react`, `next-themes` |
| Base de datos | PostgreSQL 17 + [Prisma 7](https://www.prisma.io)                        |
| Auth          | [better-auth](https://better-auth.com) (email + contraseña, roles)       |
| IA            | OpenAI Chat Completions (`gpt-4o-mini` por defecto)                      |
| Correo        | Microsoft Graph (OAuth 2.0 + PKCE, `Mail.Read`)                          |
| Tests         | `node --test` (sin framework)                                            |

## Arquitectura

Backend con **clean architecture** en `arch/` (la definición completa está en
[arch/clean-architecture.md](arch/clean-architecture.md)):

```
app/                    # Presentation: UI + Route Handlers (app/api/**) y Server Actions
components/             # UI: shadcn/ui (components/ui) + componentes de finanzas
lib/  hooks/            # utilidades y hooks de cliente
arch/
├─ shared/              # código puro, sin negocio, cross-version
└─ v1/
   ├─ domain/           # entidades + ports (interfaces) + errores de negocio. No importa de nadie.
   ├─ application/      # use-cases: orquestan el dominio, no tocan IO
   └─ infrastructure/   # adapters que implementan los ports (Prisma, OpenAI, MS Graph…)
prisma/                 # schema + migraciones + seed
scripts/                # setup de DB, seeds, sync por cron
docs/                   # guías (conexión Outlook, design system…)
```

Regla de dependencias: `presentation → application → domain` e `infrastructure → domain`.
El dominio no depende de nada; la IO se inyecta vía ports. Gracias a eso los use-cases
se testean con `node --test` sin levantar framework ni base de datos:

```bash
node --test "arch/**/*.test.ts"
```

---

## 🚀 Puesta en marcha

### Requisitos

- **Node.js 20.9+** (recomendado 22+)
- **pnpm 9+** (`corepack enable` lo instala)
- **Docker** (opcional, para levantar PostgreSQL sin instalar nada)

### 1. Clona e instala

```bash
git clone https://github.com/WDCPrado/lucaplan-app.git
cd lucaplan-app
pnpm install
```

### 2. Configura las variables de entorno

```bash
cp .env.example .env
```

| Variable                   | Requerida | Descripción                                                                 |
| -------------------------- | :-------: | --------------------------------------------------------------------------- |
| `DATABASE_URL`             | ✅        | Conexión PostgreSQL, ej. `postgresql://lucaplan:lucaplan@localhost:5432/lucaplan?schema=public` |
| `BETTER_AUTH_SECRET`       | ✅        | Génerala con `npx @better-auth/cli secret`                                  |
| `BETTER_AUTH_URL`          | ✅        | URL base de la app: `http://localhost:3005` en desarrollo                   |
| `OPENAI_API_KEY`           | opcional  | Habilita la categorización con IA ([crear key](https://platform.openai.com/api-keys)). Sin ella, la app funciona sin categorizar. |
| `OPENAI_MODEL`             | opcional  | Modelo a usar (default `gpt-4o-mini`)                                        |
| `OUTLOOK_CLIENT_ID`        | opcional  | Conexión por correo — ver [guía paso a paso](#-conectar-outlook-banco-de-chile-paso-a-paso) |
| `OUTLOOK_CLIENT_SECRET`    | opcional  | Ídem                                                                         |
| `OUTLOOK_TENANT`           | opcional  | Déjalo en `consumers` (cuentas Microsoft personales)                         |
| `OUTLOOK_REDIRECT_URI`     | opcional  | `http://localhost:3005/api/email-connection/callback` en desarrollo          |
| `OUTLOOK_WEBHOOK_URL`      | opcional  | Solo producción: URL HTTPS pública del webhook                               |
| `OUTLOOK_RENEW_SECRET`     | opcional  | Solo producción: bearer para renovar la suscripción del webhook              |
| `BANCOCHILE_ENC_KEY`       | opcional  | Llave maestra de cifrado de secretos. Si falta, se autogenera en `.bancochile-key` (gitignored). En producción defínela (≥32 chars de alta entropía) y **respáldala**. |
| `NEXT_PUBLIC_LANDING_ONLY` | opcional  | `true` = deploy vitrina: landing + login accesibles, registro cerrado — ver [Modo landing-only](#modo-landing-only) |

### 3. Levanta la base de datos

**Opción A — con Docker (recomendada para empezar):**

```bash
pnpm setup:db
```

Este script lee tu `DATABASE_URL`, levanta (o reutiliza) un contenedor
`postgres:17-alpine` llamado `lucaplan-postgres`, espera a que esté listo, aplica todas
las migraciones y ejecuta el seed de ejemplo.

> ⚠️ `setup:db` es **destructivo** (hace `prisma migrate reset`): borra todo el
> contenido de la base. Solo funciona contra `localhost` como protección. Para aplicar
> migraciones **sin borrar datos** usa `pnpm setup:prisma` (o `pnpm deploy:init` contra
> una base remota).

**Opción B — con tu propio PostgreSQL:**

Crea una base vacía, apunta `DATABASE_URL` a ella y aplica las migraciones:

```bash
pnpm setup:prisma   # prisma generate + prisma migrate deploy (aditivo, no borra)
```

### 4. Arranca

```bash
pnpm dev
```

Abre **http://localhost:3005**, entra a `/login` y crea tu cuenta (email + contraseña).
El registro está abierto por defecto; para cerrarlo en un deploy propio, mira
[Modo landing-only](#modo-landing-only) y [docs/pre-launch-lock.md](docs/pre-launch-lock.md).

### 5. (Opcional) Siembra un set de categorías con contexto para la IA

```bash
pnpm seed:categories --email=tu@correo.com
```

Crea/actualiza un set completo de categorías (Sueldo, Supermercado, Transporte,
Suscripciones…) con iconos, colores y **descripciones ricas** que la IA usa como
contexto. Es idempotente: puedes correrlo las veces que quieras.

---

## 🔑 Conectar Outlook (Banco de Chile) paso a paso

Para que Luca Plan lea las notificaciones de tu banco necesitas registrar una aplicación
en **Microsoft Entra** (gratis, con cualquier cuenta Microsoft). Eso te da el
`OUTLOOK_CLIENT_ID` y el `OUTLOOK_CLIENT_SECRET`. La guía de referencia vive en
[docs/email-connection-outlook.md](docs/email-connection-outlook.md); aquí va el paso a
paso completo.

### Requisito previo: notificaciones del banco

Activa en Banco de Chile las **notificaciones por correo** de compras y transferencias,
apuntando al buzón de Outlook que vas a conectar (la mayoría de los bancos ya las envía
por defecto).

### Paso 1 — Registra la aplicación en Microsoft Entra

1. Entra a [entra.microsoft.com](https://entra.microsoft.com) (o
   [portal.azure.com](https://portal.azure.com)) con cualquier cuenta Microsoft.
2. Ve a **Identity → Applications → App registrations → New registration**
   (Identidad → Aplicaciones → Registros de aplicaciones → Nuevo registro).
3. Completa el formulario:
   - **Name**: el que quieras, ej. `Luca Plan`.
   - **Supported account types**: elige **"Personal Microsoft accounts only"**
     (solo cuentas personales de Microsoft) — por eso `OUTLOOK_TENANT=consumers`.
   - **Redirect URI**: plataforma **Web**, con el valor exacto:
     - Desarrollo: `http://localhost:3005/api/email-connection/callback`
     - Producción: `https://tu-dominio.com/api/email-connection/callback`
       (puedes agregar ambas; deben calzar exactamente con `OUTLOOK_REDIRECT_URI`).
4. Pulsa **Register**.

### Paso 2 — Copia el Client ID

En la página **Overview** del registro, copia **Application (client) ID** →
ese es tu `OUTLOOK_CLIENT_ID`.

### Paso 3 — Crea el Client Secret

1. Ve a **Certificates & secrets → Client secrets → New client secret**.
2. Ponle una descripción y una expiración (recuerda renovarlo antes de que venza).
3. Copia el **Value** del secret **inmediatamente** (solo se muestra una vez) →
   ese es tu `OUTLOOK_CLIENT_SECRET`.

### Paso 4 — Agrega el permiso Mail.Read

1. Ve a **API permissions → Add a permission → Microsoft Graph → Delegated permissions**.
2. Busca y marca **`Mail.Read`**. Agrega.
3. **No agregues** `Mail.ReadWrite` ni `Mail.Send` — Luca Plan solo necesita leer.
   (`openid`, `profile`, `email` y `offline_access` se solicitan solos durante el OAuth;
   no requieren consentimiento de administrador para cuentas personales.)

### Paso 5 — Completa el `.env`

```env
OUTLOOK_CLIENT_ID="<Application (client) ID>"
OUTLOOK_CLIENT_SECRET="<Value del client secret>"
OUTLOOK_TENANT="consumers"
OUTLOOK_REDIRECT_URI="http://localhost:3005/api/email-connection/callback"
```

Reinicia `pnpm dev` para que tome los cambios.

### Paso 6 — Conecta desde la app

1. En el dashboard, elige conectar **Banco de Chile vía Outlook**.
2. Autoriza en la pantalla de Microsoft (verás que solo pide lectura de correo).
3. Luca Plan escanea el buzón, **detecta tus cuentas y tarjetas** desde los propios
   avisos del banco y te las propone.
4. Confirma, registra tus saldos iniciales y listo: cada aviso nuevo se convierte en un
   movimiento categorizado.

### Paso 7 — Sincronización continua

- **Desarrollo local** (sin webhook): deja `OUTLOOK_WEBHOOK_URL` vacío. Sincroniza con
  el botón **"Sincronizar ahora"** o por consola/cron:

  ```bash
  pnpm sync:email
  ```

- **Producción** (tiempo real): Microsoft exige una URL HTTPS pública para el webhook.

  ```env
  OUTLOOK_WEBHOOK_URL="https://tu-dominio.com/api/email-connection/webhook"
  OUTLOOK_RENEW_SECRET="<secreto aleatorio independiente>"
  ```

  Las suscripciones de Graph expiran, así que configura un scheduler que las renueve
  cada 12 horas:

  ```bash
  curl -X POST -H "Authorization: Bearer $OUTLOOK_RENEW_SECRET" \
    https://tu-dominio.com/api/email-connection/renew
  ```

  El delta de Graph queda como respaldo ante webhooks perdidos: cualquier "Sincronizar
  ahora" recupera lo que falte.

### Nota sobre la llave de cifrado

El refresh token de Outlook se guarda cifrado (AES-256-GCM) con `BANCOCHILE_ENC_KEY`.
En local puedes omitirla (se autogenera `./.bancochile-key`, gitignored). En producción
defínela explícitamente (≥32 caracteres de alta entropía) y **respáldala**: si cambia,
los tokens ya cifrados dejan de poder descifrarse y habrá que reconectar el correo.

---

## Scripts

| Comando                | Qué hace                                                                  |
| ---------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`             | Desarrollo en http://localhost:3005 (incluye `prisma generate`)            |
| `pnpm build`           | Build de producción                                                        |
| `pnpm start`           | Sirve el build                                                             |
| `pnpm lint`            | ESLint                                                                     |
| `pnpm typecheck`       | `tsc --noEmit`                                                             |
| `pnpm format`          | Prettier                                                                   |
| `pnpm setup:db`        | ⚠️ Levanta Postgres en Docker + migra + seed (**destructivo**, solo local) |
| `pnpm setup:prisma`    | `prisma generate` + `prisma migrate deploy` (aditivo)                      |
| `pnpm deploy:init`     | Migraciones contra una DB por argumento (primer deploy)                    |
| `pnpm migrate:db`      | `migrate deploy` a una DB elegida por consola, con confirmación            |
| `pnpm seed`            | Seed de ejemplo (Banco de Chile + categorías + movimientos)                |
| `pnpm seed:categories` | Set completo de categorías con contexto para la IA (idempotente)           |
| `pnpm sync:email`      | Corre la sincronización del correo (para cron / tarea programada)          |

Tests del backend (sin framework, sin DB):

```bash
node --test "arch/**/*.test.ts"
```

## Deploy

### Docker Compose

El repo incluye `Dockerfile` y `docker-compose.yml` (app + PostgreSQL 17). El volumen
de datos está declarado como externo para que ningún `docker compose down -v` pueda
borrarlo; créalo una vez antes del primer arranque:

```bash
docker volume create lucaplan-postgres-data
docker compose up -d --build
```

La app queda en el puerto `3005` y Postgres en `5433` (host). Los secretos se leen del
`.env`.

### Modo landing-only

Para un deploy público tipo vitrina del proyecto (por ejemplo en Railway): setea
`NEXT_PUBLIC_LANDING_ONLY="true"`. La landing y `/login` quedan accesibles, pero el
**registro se cierra** (solo entran cuentas existentes), el login enlaza al repo de
GitHub para instalar en local, y el resto de rutas sin sesión redirige a `/`.

## Documentación adicional

- [arch/clean-architecture.md](arch/clean-architecture.md) — definición de la arquitectura y regla de dependencias.
- [docs/email-connection-outlook.md](docs/email-connection-outlook.md) — referencia de la conexión Outlook / Microsoft Graph.
- [docs/design/design-system.md](docs/design/design-system.md) — design system (tokens, glass, dark/light). La fuente de verdad visual es [app/globals.css](app/globals.css).
- [docs/pre-launch-lock.md](docs/pre-launch-lock.md) — cómo cerrar/abrir el registro.
- [PRODUCT.md](PRODUCT.md) — propósito de producto, personalidad de marca y principios de diseño.

## Contribuir

1. Haz fork y crea una rama desde `master`.
2. Las features nuevas siguen el flujo [OpenSpec](openspec/) del repo (propuesta →
   implementación → verificación); para fixes pequeños basta el PR directo.
3. Antes de abrir el PR: `pnpm lint && pnpm typecheck && node --test "arch/**/*.test.ts"`.
4. Respeta la regla de dependencias de `arch/` y los primitivos de UI (shadcn/ui — si
   falta un componente, se instala con `pnpm dlx shadcn@latest add <componente>`).

---

<div align="center">

Hecho en Chile 🇨🇱 por [Welliton da Costa Prado](https://www.linkedin.com/in/welliton-da-costa-prado-5050b4251)

Tratamiento de datos conforme a la Ley 21.719 (Chile).

</div>
