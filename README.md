<div align="center">

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
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

![Landing de Luca Plan](docs/images/landing-hero.png)

## Punto de entrada

Este README es la **fuente canónica** del proyecto: lo leen personas, agentes, OpenSpec y Linear
antes de definir o implementar cualquier cambio. Desde aquí se abre la documentación
especializada; nada de lo que está en `docs/` se duplica en otra parte.

Jerarquía de fuentes, de mayor a menor autoridad:

1. **El código** — el comportamiento real (`app/`, `arch/`, `prisma/schema.prisma`, `app/globals.css`).
2. **Este README** — contexto vigente y mapa documental.
3. **`docs/`** — el detalle de cada tema (ver [mapa documental](#mapa-documental)).
4. **`openspec/specs/`** — contrato de comportamiento por capacidad; `openspec/changes/` es el
   delta en curso y `openspec/changes/archive/` el historial (puede describir integraciones ya
   retiradas: es historia, no contrato).
5. **Linear** — planificación y seguimiento. No duplica documentación técnica; enlaza aquí.

Si dos fuentes se contradicen, se corrige primero la fuente canónica y luego lo demás.
`AGENTS.md` y `CLAUDE.md` solo apuntan aquí: no llevan reglas propias.

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
- En débito y crédito, el gastado y el comprometido del plan solo incluyen categorías
  de gasto con tope efectivo mayor que cero, dentro del período. Sin categoría o sin
  tope quedan fuera; los excesos sobre un tope cuentan completos. Las categorías sin
  tope se pueden consultar en un grupo cerrado por defecto.
- Categorías de ingreso con avance hacia tu meta mensual.
- Modo débito usa mes calendario; modo crédito usa ciclo de tarjeta. Ambos incluyen
  movimientos de corriente y tarjeta: el modo solo cambia las fechas del plan.
- «Ajustar plan» sugiere los ingresos disponibles menos el exceso de gastos y compromisos
  pendientes del período anterior sobre su presupuesto global: mes en débito, ciclo en crédito.
  Al pagar un compromiso, pasa a gasto sin descontarse dos veces; aplicar la sugerencia es manual.
- El resumen del plan separa el margen del plan de la liquidez registrada (caja menos línea
  usada, con el desglose cuando hay línea). Un plan cubierto no oculta corriente negativa. Los saldos son los últimos registrados,
  no una reconstrucción histórica del mes seleccionado.
- Selector de mes para navegar tu historial; movimientos con búsqueda y filtros.

### 🤖 Categorización con IA que aprende de ti

![Categorización con IA](docs/images/ai-categorization.png)

- Entiende el lenguaje bancario crudo: `Pago:payu *uber eats` es Comida, no un misterio.
- Cada categoría lleva una **descripción tuya** que la IA usa como contexto: tú defines
  qué significa "Cuentas" en tu vida.
- Aprende de tus recategorizaciones y ofrece aplicar el cambio a los movimientos
  similares en un clic.
- Un movimiento sin categoría se clasifica desde su detalle.
- Funciona con OpenAI (`gpt-4o-mini` por defecto) y se degrada con gracia: sin API key
  la app funciona igual, solo que los movimientos quedan sin categorizar.

### 💬 Operaciones financieras desde un asistente

El paquete MCP de Luca Plan permite que un host compatible consulte y administre los datos del
usuario que autorizó la conexión. La conciliación bancaria permite previsualizar y aplicar
correcciones de moneda, importe, fecha y categoría por ID, junto con saldos al corte y auditoría,
sin duplicar cargos ni perder vínculos. La identidad y los permisos se resuelven en el servidor mediante
OAuth; el modelo no elige el usuario. Alcance, instalación y límites en la
[guía del plugin](docs/plugin-luca-plan.md).

### 📷 Actualizar saldo con una captura

Abres la tarjeta, **Actualizar saldo**, subes una captura de la app de tu banco y la IA lee los
montos. No hay que ordenar la captura ni recortarla: el navegador la reescala solo antes de subirla.

- **Hasta 5 capturas de una vez.** El banco reparte los datos entre pantallas —el cupo
  internacional suele estar aparte del nacional—, así que se juntan todas y se leen en una sola
  llamada: un prompt, una respuesta ya combinada.

- **Se adapta a lo que muestre la pantalla.** Casi ninguna app del banco muestra todas las
  variables: si trae el cupo y el disponible, el usado sale de la resta; si trae solo el disponible,
  se completa con el cupo que ya tienes guardado. El saldo de la cuenta corriente conserva su
  signo y se guarda separado de la línea: puede ser negativo aunque la línea esté sin uso.
  Un saldo negativo no permite deducir la deuda ni el cupo de la línea.
  Cuando no alcanza para calcular nada, ese saldo se deja intacto en vez de inventarlo.
- **Tú confirmas antes de guardar.** La lectura puede equivocarse en un dígito y dar un monto
  perfectamente válido, que ninguna validación podría detectar: por eso los montos se muestran
  editables y nada se guarda hasta que los apruebas. Los saldos derivados los calcula el servidor.
- **Barata por diseño.** Se lee en detalle bajo (costo fijo por imagen, sin importar el tamaño) y
  solo se reintenta en detalle alto si no se reconoció nada. La respuesta va con esquema estricto,
  así que no hay reintentos por formato.
- **La imagen no se guarda** en ninguna parte: se procesa y se descarta.

### 🧾 Los movimientos vienen del banco

Los movimientos entran solo desde los avisos del banco por correo: la app no tiene alta manual ni
lectura de cartolas por foto, así nada se cuenta dos veces cuando el correo llega.

### 📬 Conexión por correo: tu banco ya te avisa, Luca Plan escucha

![Conexión por correo](docs/images/email-connection.png)

- Hoy: **Banco de Chile**, **Banco BICE** y **MACHBANK** (solo débito) vía **Outlook**
  (Microsoft Graph) — un mismo correo puede alimentar varios bancos. Gmail, próximamente.
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

### 🔔 Notificaciones donde estés

- Web Push estándar (VAPID): **Android**, **Windows** y **iOS 16.4+** con la app añadida a la
  pantalla de inicio — sin tienda ni SDK de terceros.
- Te avisa de los movimientos que entran solos por correo, cuando el gasto del mes cruza alguno de
  tus umbrales de presupuesto, y de los pagos recurrentes o cuotas por vencer.
- Los umbrales los defines tú en **Configuración → Alertas de presupuesto**: los que quieras (50%,
  80%, 120%…), cada uno con su slider.
- El contenido viaja cifrado de extremo a extremo y no se guarda: del dispositivo solo se conserva
  su endpoint de entrega. Se activa (y desactiva) desde **Configuración**.
  Configuración en [docs/push-notifications.md](docs/push-notifications.md).

## Stack

| Capa          | Tecnología                                                              |
| ------------- | ----------------------------------------------------------------------- |
| Framework     | [Next.js 16](https://nextjs.org) (App Router) + [React 19](https://react.dev) |
| Lenguaje      | TypeScript                                                               |
| UI            | [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) + Base UI, `lucide-react`, `next-themes` |
| Base de datos | PostgreSQL 17 + [Prisma 7](https://www.prisma.io)                        |
| Auth          | [better-auth](https://better-auth.com) (código por correo, roles)       |
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
| `RESEND_API_KEY` | ✅ para login | Clave privada de envío; solo servidor. |
| `RESEND_FROM` | opcional | Remitente verificado; default `Luca Plan <no-reply@lucaplan.cl>`. |
| `BETTER_AUTH_URL`          | ✅        | URL base de la app: `http://localhost:3005` en desarrollo                   |
| `OPENAI_API_KEY`           | opcional  | Habilita la categorización con IA y la lectura de saldos por captura ([crear key](https://platform.openai.com/api-keys)). Sin ella, la app funciona igual: los movimientos quedan sin categorizar y los saldos se escriben a mano. |
| `OPENAI_MODEL`             | opcional  | Modelo a usar (default `gpt-4o-mini`)                                        |
| `OUTLOOK_CLIENT_ID`        | opcional  | Conexión por correo — ver [guía paso a paso](#-conectar-outlook-banco-de-chile-paso-a-paso) |
| `OUTLOOK_CLIENT_SECRET`    | opcional  | Ídem                                                                         |
| `OUTLOOK_TENANT`           | opcional  | Déjalo en `consumers` (cuentas Microsoft personales)                         |
| `OUTLOOK_REDIRECT_URI`     | opcional  | `http://localhost:3005/api/email-connection/callback` en desarrollo          |
| `OUTLOOK_WEBHOOK_URL`      | opcional  | Solo producción: URL HTTPS pública del webhook                               |
| `OUTLOOK_RENEW_SECRET`     | opcional  | Solo producción: bearer para renovar la suscripción del webhook              |
| `VAPID_PUBLIC_KEY`         | opcional  | Notificaciones push (Android, iOS 16.4+ instalada, Windows). Genera el par con `pnpm exec web-push generate-vapid-keys` — ver [guía](docs/push-notifications.md). Sin claves, la app no ofrece ni envía notificaciones. |
| `VAPID_PRIVATE_KEY`        | opcional  | Ídem. Nunca sale del servidor.                                               |
| `VAPID_SUBJECT`            | opcional  | Contacto que exige VAPID, ej. `mailto:tu@correo.com`                         |
| `CRON_SECRET`              | opcional  | Solo producción: bearer de `POST /api/cron/notify-due` (recordatorio diario de vencimientos). Sin él, ese endpoint rechaza todo. |
| `BANCOCHILE_ENC_KEY`       | opcional  | Llave maestra de cifrado de secretos. Si falta, se autogenera en `.bancochile-key` (gitignored). En producción defínela (≥32 chars de alta entropía) y **respáldala**. |

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

Abre **http://localhost:3005** y entra a `/login` con el código que llega al correo.
El registro público está cerrado: crea la cuenta con `pnpm create:account --db-prod "postgresql://..." --email persona@example.com`.
Configura `RESEND_API_KEY` en el servidor; [acceso por correo](docs/login-code.md) explica el remitente, la transición y las pruebas locales.

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
| `pnpm test`            | Tests con `node --test` (`arch/`, `lib/` y `scripts/`)                     |
| `pnpm format`          | Prettier                                                                   |
| `pnpm setup:db`        | ⚠️ Levanta Postgres en Docker + migra + seed (**destructivo**, solo local) |
| `pnpm setup:prisma`    | `prisma generate` + `prisma migrate deploy` (aditivo)                      |
| `pnpm deploy:init`     | Migraciones contra una DB por argumento (primer deploy)                    |
| `pnpm migrate:db`      | `migrate deploy` a una DB elegida por consola, con confirmación            |
| `pnpm seed`            | Seed de ejemplo (Banco de Chile + categorías + movimientos)                |
| `pnpm seed:pr`         | Datos falsos para un entorno de PR de Railway; fuera de ahí no hace nada   |
| `pnpm seed:categories` | Set completo de categorías con contexto para la IA (idempotente)           |
| `pnpm create:account`  | Crea una cuenta en la base que se le indique por `--db-prod`               |
| `pnpm sync:email`      | Corre la sincronización del correo (para cron / tarea programada)          |
| `pnpm notify:due`      | Notifica los pagos por vencer (recurrentes y cuotas); una corrida diaria    |

En el despliegue el recordatorio no lo corre este script sino un **servicio cron** de Railway que
llama `POST /api/cron/notify-due` (y `/api/email-connection/renew`) con secreto Bearer — código y
variables en [docs/push-notifications.md](docs/push-notifications.md#agendarlo-en-railway).

Tests del backend (sin framework, sin DB):

```bash
node --test "arch/**/*.test.ts"
```

## Deploy

### Coolify en Ubuntu WSL2

Coolify administra la app desde el repositorio privado y su `Dockerfile`, PostgreSQL 18 como
recurso nativo y los trabajos periódicos como Scheduled Tasks. El túnel Cloudflare es un recurso
separado. GitHub valida el código; al mergear en `master`, su webhook firmado dispara el
auto-deploy nativo de Coolify. Backups programados, corte desde Docker Desktop y recuperación están en la
[guía de Coolify](docs/coolify.md).

### Docker Compose

Para operar la instancia personal con base aislada, cron y HTTPS público por Cloudflare Tunnel, usa
[`compose.production.yml`](compose.production.yml) y la [guía de instalación local](docs/self-hosting.md).
El Compose descrito a continuación sigue siendo el entorno de desarrollo existente.

El repo incluye `Dockerfile` y `docker-compose.yml` (app + PostgreSQL 17). El volumen
de datos está declarado como externo para que ningún `docker compose down -v` pueda
borrarlo; créalo una vez antes del primer arranque:

```bash
docker volume create lucaplan-postgres-data
docker compose up -d --build
```

La app queda en el puerto `3005` y Postgres en `5433` (host). Los secretos se leen del
`.env`.

### Railway: entornos de PR con datos falsos

El arranque de la imagen aplica las migraciones y luego corre `pnpm seed:pr`. Ese script solo
siembra cuando `RAILWAY_ENVIRONMENT_NAME` termina en `pr-<número>` — Railway inyecta esa variable
sola y nombra así los entornos efímeros de pull request (`pr-2`, o `lucaplan-app-pr-2` cuando el
proyecto tiene varios servicios). En `production` (y en local, y en Docker Compose) se salta sin
tocar la base. No hay nada que configurar.

Los seeds históricos siguen creando datos por escena, sin contraseña ni acceso automático.
Para este entorno Docker se usa una preview local aislada con correo simulado, como describe
[acceso por correo](docs/login-code.md). No se envía correo a cuentas ficticias reales.

| Variable            | Default            | Para qué                                                       |
| ------------------- | ------------------ | -------------------------------------------------------------- |
| `SEED_PR_EMAIL`     | `demo@lucaplan.cl` | Correo del usuario base con el que entras al entorno del PR      |
| `SEED_PR_FORCE`     | —                  | `1` borra los datos de los usuarios demo y los vuelve a sembrar en el próximo deploy |

Es idempotente: si un usuario demo ya existe, los redeploys del PR no lo tocan (lo que probaste
sigue ahí). A cada uno le siembra 2 cuentas con cupos separados por moneda, 9 categorías con
contexto para la IA, presupuesto global y por categoría, sueldo con carry-forward, movimientos del
mes en curso y del anterior, 3 gastos recurrentes y 2 planes de cuotas (tarjeta y crédito de
consumo).

#### Escenas: los datos de cada feature

Ese usuario base es el mismo para todos los PR y muestra la app en su estado normal. Lo que una
feature necesita para poder mirarse va en una **escena**: un archivo en
[`scripts/seed-pr/escenas/`](scripts/seed-pr/escenas/) con **su propio usuario demo**, que el seed
descubre recorriendo la carpeta en orden alfabético. Cada escena exporta `correo`, `titulo` y
`seed`, y recibe el usuario ya sembrado (`prisma`, `userId`, cuenta corriente, tarjeta y el mapa
nombre → id de las categorías), así que son unas pocas líneas.

Un usuario por escena es lo que permite que no se estorben: ninguna deforma los datos de otra ni
los del usuario base, y ninguna se borra cuando llega el PR siguiente — las features viejas se
siguen pudiendo probar. Como no hay archivo compartido (no hay `index.ts` a propósito), dos ramas
en paralelo tampoco chocan.

Ojo con qué garantiza qué: la partición es el `userId`, pero el `prisma` que recibe una escena es
el cliente normal, **sin límite por usuario**. El aislamiento es una **regla que cada escena
cumple** filtrando por el `userId` de su contexto, no algo que la estructura imponga; un `where`
sin él alcanza a los demás usuarios demo.

Cada escena conserva su usuario y correo; el acceso requiere un código, igual que el login normal.

Cada escena corre aislada: si una falla —típicamente una vieja contra un esquema que ya cambió— el
seed lo registra y sigue con las demás, en vez de caerse el deploy. Cómo escribir una, en
[docs/development.md](docs/development.md#sembrar-los-datos-de-la-feature).

## Mapa documental

| Tema                        | Dónde                                                                 |
| --------------------------- | --------------------------------------------------------------------- |
| Producto y experiencia      | [docs/product.md](docs/product.md) — usuarios, propósito, posicionamiento, reglas de dominio, compromisos de marca, evidencia real, principios de diseño y accesibilidad. |
| Arquitectura                | [arch/clean-architecture.md](arch/clean-architecture.md) — capas y regla de dependencias. |
| Desarrollo y contribución   | [docs/development.md](docs/development.md) — flujo de trabajo, Next 16, reglas de UI, mocks, convenciones y verificaciones. |
| Design system               | [docs/design/design-system.md](docs/design/design-system.md) — tokens, glass, dark/light. La fuente de verdad visual es [app/globals.css](app/globals.css). |
| Notificaciones push         | [docs/push-notifications.md](docs/push-notifications.md) — Web Push (VAPID) en Android, iOS 16.4+ y Windows: configuración, eventos y cron. |
| Outlook / Microsoft Graph   | [docs/email-connection-outlook.md](docs/email-connection-outlook.md) — referencia de la conexión de correo con Banco de Chile. El paso a paso está [más arriba](#-conectar-outlook-banco-de-chile-paso-a-paso). |
| Correos bancarios           | [docs/bank-email-contract.md](docs/bank-email-contract.md) — catálogo de correos soportados y qué debe aportar un banco nuevo. |
| Plugin Luca Plan            | [docs/plugin-luca-plan.md](docs/plugin-luca-plan.md) — paquete MCP, autorización por usuario, catálogo de operaciones y conexión con ChatGPT o Codex. |
| Acceso por correo          | [Código de acceso y Resend](docs/login-code.md). |
| Operación y despliegue      | [Scripts](#scripts) y [Deploy](#deploy) en este README; [Coolify y migración](docs/coolify.md); [Docker local y recuperación del origen](docs/self-hosting.md). |
| Specs y cambios             | [openspec/README.md](openspec/README.md) — capacidades canónicas, cambios en curso y archivo histórico. |

## Contribuir

1. Haz fork y crea una rama desde `master`.
2. Lee [docs/development.md](docs/development.md): el flujo por defecto parte del pedido y el
   issue, sigue con implementación, revisión y verificación. OpenSpec es optativo y se usa solo
   cuando Willy lo pide expresamente.
3. Antes de abrir el PR: `pnpm lint && pnpm typecheck && pnpm test`.
4. Respeta la regla de dependencias de `arch/` y los primitivos de UI (shadcn/ui — si
   falta un componente, se instala con `pnpm dlx shadcn@latest add <componente>`).

## Licencia

Este proyecto se distribuye bajo la **licencia [MIT](LICENSE)**. En resumen:

- **Puedes** usar, copiar, modificar, fusionar, publicar, distribuir, sublicenciar y
  vender copias del software, incluso con fines comerciales.
- **Debes** incluir el aviso de copyright y el texto de la licencia en toda copia o
  parte sustancial del software.
- **Sin garantía**: el software se entrega "tal cual" (*as is*), sin garantía de ningún
  tipo; los autores no responden por daños derivados de su uso.

El texto legal completo (en inglés, la versión vinculante) está en [LICENSE](LICENSE).

---

<div align="center">

Hecho en Chile 🇨🇱 por [Welliton da Costa Prado](https://www.linkedin.com/in/welliton-da-costa-prado-5050b4251)

Privacidad conforme a la Ley 19.628 y preparada para la Ley 21.719 (Chile).

</div>


