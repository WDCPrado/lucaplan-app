<div align="center">

# Luca Plan

**Este mes sí tiene un plan.**

Finanzas personales, un mes a la vez. Conecta tu correo, deja que la IA categorice tus
gastos y cuadra tu presupuesto mensual, sin entregarle tus claves bancarias a nadie.

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

## Qué es

Luca Plan es una app **open source** de planificación financiera personal, pensada para Chile.
Reúne tus cuentas, tarjetas y movimientos, los categoriza con IA y arma un plan mensual:
cuánto entra, cuánto reservaste y cuánto te queda para gastar.

**Cada mes parte limpio.** En vez de un saldo acumulado que ya no dice nada, trabajas con
presupuestos que reinician contigo cada mes.

**Se conecta a tu correo, no a tu banco.** Tu banco ya te avisa cada compra por email. Luca Plan
lee solo esos avisos (permiso de solo lectura, revocable) y convierte cada uno en un movimiento
categorizado. Nunca conoce tus claves bancarias ni puede mover tu plata.

## Qué hace

![Plan del mes: movimientos, presupuestos y tarjetas](docs/images/app-components.png)

- **Cuentas y tarjetas.** Corrientes, de ahorro, tarjetas de crédito, líneas de crédito,
  billeteras e inversiones. Las tarjetas llevan cupo nacional (CLP) y cupo internacional (USD) por
  separado: las monedas nunca se mezclan. El dólar referencial sale de
  [mindicador.cl](https://mindicador.cl).
- **Presupuesto mensual.** Límite global y por categoría, con progreso por categoría y lo que te
  queda por gastar. Funciona en **modo débito** (mes calendario) o **modo crédito** (ciclo de la
  tarjeta), cada uno con su plan. Las reglas completas están en [docs/product.md](docs/product.md).
- **Recurrentes y cuotas.** Lo que todavía no se cobra cuenta como comprometido y se descuenta de
  lo que puedes gastar. Las compras en cuotas muestran la cuota del mes y cuánto falta.
- **Categorización con IA.** Entiende la glosa cruda del banco (`Pago:payu *uber eats` es Comida)
  y usa la descripción que tú le pones a cada categoría. Cuando recategorizas un movimiento,
  ofrece aplicarlo a los parecidos. Sin clave de OpenAI la app funciona igual, pero los
  movimientos quedan sin categorizar.
- **Notificaciones push.** Android, Windows e iOS 16.4+ con la app en la pantalla de inicio, sin
  servicios de terceros. Avisan de movimientos nuevos, umbrales de presupuesto y pagos por vencer.
  Configuración en [docs/push-notifications.md](docs/push-notifications.md).
- **Asistente por MCP.** Un asistente (Claude, ChatGPT, Claude Code) puede consultar y cuadrar tus
  datos, incluida la conciliación con la cartola. Ver [Conectar un asistente](#conectar-un-asistente).

### Los movimientos vienen del banco

![Conexión de correo y bancos disponibles](docs/images/email-connection.png)

Los movimientos entran desde los avisos del banco por correo, así nada se cuenta dos veces. La app
no tiene alta manual de movimientos en pantalla. Lo que el correo no avisa (saldos, cupos, cargos
sin aviso) se corrige desde el asistente MCP.

| Banco | Estado |
| --- | --- |
| Banco de Chile, Banco BICE, MACHBANK (solo débito) | Disponible, vía **Outlook** |
| Santander, BCI, Banco Estado, Itaú, Banco Falabella, Scotiabank | Próximamente |
| Gmail como buzón | Próximamente |

Un mismo buzón puede alimentar varios bancos. Los pendientes están en
[`lib/coming-soon-banks.ts`](lib/coming-soon-banks.ts); qué debe aportar un banco nuevo, en
[docs/bank-email-contract.md](docs/bank-email-contract.md).

- **Permiso mínimo.** OAuth 2.0 con PKCE y solo `Mail.Read`: no puede enviar, mover ni borrar
  correos.
- **Solo el banco.** Se procesan únicamente los remitentes oficiales del banco. De cada aviso se
  guarda el movimiento (monto, comercio, fecha); el cuerpo del correo se procesa en memoria.
- **Cuentas detectadas solas.** Desde los propios avisos propone tus cuentas y tarjetas. La carga
  inicial trae los últimos **3 meses** y la IA los categoriza.
- **Sincronización.** Automática por webhook si tu servidor es público ([ver Outlook](#conectar-outlook)),
  o a mano con el botón **Sincronizar**.
- **Desconexión en un clic.** Borra la conexión, los movimientos importados y el token. El refresh
  token se guarda cifrado con AES-256-GCM.

## Primer uso

Hay dos caminos, según si la base tiene cuentas o no.

### Instalación nueva: `/setup`

Con la base **vacía**, `/` y `/login` redirigen a `/setup`. Solo existe mientras no haya ninguna
cuenta; en cuanto se crea la primera, `/setup` deja de existir.

<!-- captura: docs/images/setup.png — /setup con la base vacía, ya verificado el código de instalación, en el paso "Ordena tus gastos con OpenAI" (campo de clave y guía a la vista) -->

1. Al arrancar, el servidor imprime en su consola un código de instalación de 12 caracteres:
   `[setup] Código de instalación: ABCD-EFGH-JKLM`. Solo lo ve quien opera el servidor.
2. Ingresas el código en `/setup` (máximo 5 intentos por hora por IP).
3. Cargas las claves de **Resend**, **OpenAI** y **Outlook**. OpenAI y Outlook son opcionales; en
   local Resend también, pero fuera de local es obligatorio porque sin él no llega el código de
   acceso.
4. Creas la primera cuenta con el login de siempre (código por correo). **Queda como ADMIN.**
5. Sigue el [onboarding](#onboarding-con-ia).

### Registro de más personas

El registro lo controla `SIGNUP_OPEN`:

- `SIGNUP_OPEN=true` (exacto): un correo nuevo recibe su código y su cuenta se crea al verificarlo.
- Cualquier otro valor lo deja cerrado. Una cuenta se crea entonces a mano con
  `pnpm create:account --db-prod "postgresql://..." --email persona@example.com`.
- En local (`NODE_ENV=development`) siempre está abierto.

Se entra con un **código de 6 dígitos por correo** (Resend). En local, sin `RESEND_API_KEY`, el
código sale en la consola del servidor. Detalle en [docs/login-code.md](docs/login-code.md).

### Onboarding con IA

![Onboarding: categorías propuestas por la IA](docs/images/ai-categorization.png)

Toda cuenta nueva pasa por un onboarding corto:

1. **Cuentas tu día a día** y OpenAI propone categorías a partir de un set predefinido, explicando
   qué agregó o cambió. Sin clave de OpenAI te quedas con el set predefinido.
2. **Conectas tu banco por Outlook**, la única opción por ahora. Puedes omitir este paso.
3. Se **importan y categorizan los últimos 3 meses** de avisos del banco.
4. Revisas lo importado y defines tus ingresos.

## Integraciones desde la app

Las claves de OpenAI, Outlook y Resend se pueden cargar en **Ajustes → Integraciones**, sin
reiniciar el servidor. Solo las ve y las cambia un **ADMIN**.

<!-- captura: docs/images/integraciones.png — /settings con sesión ADMIN, sección Integraciones: una clave del entorno (bloqueada), una guardada (••••abcd) y una sin configurar, con la guía de un proveedor abierta si cabe -->

| Proveedor | Claves |
| --- | --- |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Outlook | `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_TENANT` |
| Resend | `RESEND_API_KEY`, `RESEND_FROM` |

- **El entorno manda.** Si la variable de entorno existe y no está vacía, se usa esa y en Ajustes
  queda bloqueada.
- **Secretos cifrados.** Se guardan cifrados en la base y solo se muestran sus últimos 4 caracteres.
- **Fuera de local hace falta `BANCOCHILE_ENC_KEY`** (32 caracteres o más) para guardar secretos.
  Respáldala: si cambia, las claves guardadas dejan de descifrarse y hay que cargarlas de nuevo.
- Cada proveedor trae su **guía paso a paso** dentro de la app.
- Una instalación que ya tenía cuentas antes de esta función no tiene ADMIN: ver
  [cómo hacerse ADMIN](docs/self-hosting.md#hacerse-admin).

## Puesta en marcha (desarrollo)

**Requisitos:** Node.js 24 (el de CI y Docker), pnpm 10 y Docker (opcional, para PostgreSQL).

```bash
git clone https://github.com/WDCPrado/lucaplan-app.git
cd lucaplan-app
pnpm install
cp .env.example .env
```

### Variables de entorno

Las mínimas para partir:

| Variable | Descripción |
| --- | --- |
| `DATABASE_URL` | Conexión a PostgreSQL, p. ej. `postgresql://lucaplan:lucaplan@localhost:5432/lucaplan?schema=public`. |
| `BETTER_AUTH_SECRET` | Secreto de sesión. Genéralo con `npx @better-auth/cli secret`. |
| `BETTER_AUTH_URL` | Origen público de la app. En desarrollo, `http://localhost:3005` (el puerto de `pnpm dev`). Se usa para el callback de Outlook y para el recurso MCP. |

Opcionales (las de OpenAI, Outlook y Resend también se cargan desde [Ajustes](#integraciones-desde-la-app)):

| Variable | Para qué |
| --- | --- |
| `SIGNUP_OPEN` | `true` abre el registro. |
| `RESEND_API_KEY`, `RESEND_FROM` | Envío del código de acceso. Obligatorias en producción. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Categorización con IA (modelo por defecto: `gpt-4o-mini`). |
| `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_TENANT` | Conexión de correo. El tenant por defecto es `consumers`. |
| `OUTLOOK_REDIRECT_URI` | Solo si el callback no es `<BETTER_AUTH_URL>/api/email-connection/callback`. |
| `OUTLOOK_WEBHOOK_URL`, `OUTLOOK_RENEW_SECRET` | Avisos automáticos de correos nuevos. Requieren HTTPS público. |
| `BANCOCHILE_ENC_KEY` | Llave de cifrado de secretos. En local se autogenera en `.bancochile-key`; en producción, 32+ caracteres y respaldada. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Notificaciones push. Genera el par con `pnpm exec web-push generate-vapid-keys`. |
| `CRON_SECRET` | Bearer de `POST /api/cron/notify-due` (recordatorio diario de vencimientos). Sin él, el endpoint rechaza todo. |

### Base de datos

**Con Docker** (levanta `postgres:17-alpine` en un contenedor `lucaplan-postgres`, migra y siembra
la cuenta demo):

```bash
pnpm setup:db
```

> `setup:db` es **destructivo** (`prisma migrate reset`): borra todo el contenido de la base. Solo
> corre contra `localhost`. Para migrar sin borrar usa `pnpm setup:prisma`.

**Con tu propio PostgreSQL:** crea una base vacía, apunta `DATABASE_URL` a ella y corre
`pnpm setup:prisma`. Como queda sin cuentas, la app te lleva a [`/setup`](#instalación-nueva-setup).

### Arranca

```bash
pnpm dev
```

Abre la app en **http://localhost:3005** (`pnpm dev` aplica las migraciones y corre en ese puerto).

- Si sembraste con `setup:db`: entra con `demo@lucaplan.cl` y el código fijo `000000`, sin correo
  (solo en local y en entornos de PR).
- Si la base está vacía: sigue [`/setup`](#instalación-nueva-setup); el código de instalación
  aparece en la terminal de `pnpm dev`.

## Conectar Outlook

Para que Luca Plan lea los avisos de tu banco necesitas una app en **Microsoft Entra** (gratis).
Activa antes en tu banco las notificaciones por correo y apúntalas al buzón de Outlook que vas a
conectar.

1. En [entra.microsoft.com](https://entra.microsoft.com), ve a **App registrations → New
   registration**.
2. **Supported account types:** *Personal Microsoft accounts only*. Por eso `OUTLOOK_TENANT` es
   `consumers`, el valor por defecto.
3. **Redirect URI:** plataforma **Web** y `<origen>/api/email-connection/callback`, donde
   `<origen>` es tu `BETTER_AUTH_URL` (en desarrollo, `http://localhost:3005`).
4. En **Overview**, copia el **Application (client) ID**: es `OUTLOOK_CLIENT_ID`.
5. En **Certificates & secrets**, crea un **Client secret** y copia el **Value** al tiro (se muestra
   una sola vez): es `OUTLOOK_CLIENT_SECRET`.
6. En **API permissions → Microsoft Graph → Delegated permissions**, marca solo **`Mail.Read`**.
   No agregues `Mail.ReadWrite` ni `Mail.Send`.
7. Carga las tres claves en **Ajustes → Integraciones** (o en el `.env`) y conecta tu banco desde la
   app: autoriza en Microsoft, confirma las cuentas que detecta y registra tus saldos iniciales.

Conectar el buzón y la primera importación funcionan con `localhost`.

**Avisos automáticos.** Para que los correos nuevos entren solos, Microsoft exige una URL HTTPS
pública. Define `OUTLOOK_WEBHOOK_URL=https://<tu-dominio>/api/email-connection/webhook` y
`OUTLOOK_RENEW_SECRET` (un secreto aleatorio). Las suscripciones expiran, así que un scheduler debe
renovarlas cada 12 horas:

```bash
curl -X POST -H "Authorization: Bearer $OUTLOOK_RENEW_SECRET" \
  https://<tu-dominio>/api/email-connection/renew
```

Sin `OUTLOOK_WEBHOOK_URL` (p. ej. en local) los correos nuevos se traen a mano con el botón
**Sincronizar** o con `pnpm sync:email`. Detalle y recuperación de fallos en
[docs/email-connection-outlook.md](docs/email-connection-outlook.md).

## Conectar un asistente

El conector MCP **no se publica en ninguna tienda**: se agrega por URL, `https://<tu-dominio>/api/mcp`,
con OAuth (inicias sesión en Luca Plan y aceptas los permisos).

- **Claude (web y Desktop):** Ajustes → Conectores → conector personalizado.
- **ChatGPT:** modo desarrollador → servidor MCP personalizado.
- **Claude Code:** `claude mcp add --transport http luca-plan https://<tu-dominio>/api/mcp`.

Claude y ChatGPT web exigen una URL **HTTPS pública**: `localhost` no les sirve. Para probar contra
tu entorno local usa Claude Code. Pasos, alcance y catálogo de herramientas en
[docs/plugin-luca-plan.md](docs/plugin-luca-plan.md).

## Stack

| Capa | Tecnología |
| --- | --- |
| Framework | [Next.js 16](https://nextjs.org) (App Router) y [React 19](https://react.dev) |
| UI | [Tailwind CSS v4](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com) sobre Radix, `lucide-react`, `next-themes` |
| Base de datos | PostgreSQL y [Prisma 7](https://www.prisma.io) |
| Auth | [better-auth](https://better-auth.com): código por correo, roles y OAuth para MCP |
| IA | OpenAI Chat Completions |
| Correo | Microsoft Graph (OAuth 2.0 con PKCE, `Mail.Read`) |
| Tests | `node --test`, sin framework |

## Arquitectura

El backend sigue **clean architecture** en `arch/` (definición en
[arch/clean-architecture.md](arch/clean-architecture.md)):

```
app/              # UI y Route Handlers (app/api/**)
components/       # shadcn/ui (components/ui) y componentes de finanzas
lib/  hooks/      # utilidades, esquemas compartidos y hooks de cliente
arch/
├─ shared/        # código puro, sin negocio
└─ v1/
   ├─ domain/          # entidades, ports y errores de negocio; no importa de nadie
   ├─ application/     # casos de uso: orquestan el dominio, sin IO directo
   └─ infrastructure/  # adapters de los ports: Prisma, OpenAI, Microsoft Graph, Resend…
prisma/           # schema y migraciones
scripts/          # base de datos, seeds, sync manual y recordatorios
docs/             # guías
```

Regla de dependencias: `app → application → domain` e `infrastructure → domain`. La IO entra por
ports, así los casos de uso se prueban con `node --test` sin framework ni base de datos.

## Scripts

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Desarrollo en http://localhost:3005 (migra y genera el cliente Prisma). |
| `pnpm build` / `pnpm start` | Build de producción y servidor. |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | ESLint, `tsc --noEmit` y Prettier. |
| `pnpm test` | Tests con `node --test` (`arch/`, `lib/` y `scripts/`). Sin base de datos. |
| `pnpm setup:db` | Postgres en Docker, migraciones y seed demo. **Destructivo**, solo `localhost`. |
| `pnpm setup:prisma` | `prisma generate` y `migrate deploy`, sin borrar datos. |
| `pnpm migrate:db` | `migrate deploy` contra una base elegida por consola, con confirmación. |
| `pnpm deploy:init` | Migraciones contra una base remota, para el primer deploy. |
| `pnpm seed` | Siembra la cuenta demo en una base local. |
| `pnpm create:account` | Crea una cuenta en la base que le indiques con `--db-prod`. |
| `pnpm sync:email` | Sincroniza el correo a mano. |
| `pnpm notify:due` | Notifica pagos por vencer (recurrentes y cuotas). |

## Despliegue

- **Docker Compose:** `docker volume create lucaplan-postgres-data` una vez, y luego
  `docker compose up -d --build`. La app queda en el puerto `3005` y Postgres en `5433`; los
  secretos salen del `.env`. Con la base vacía, el código de instalación aparece en
  `docker compose logs app`.
- **Instancia propia con Cloudflare Tunnel o Coolify:** [docs/self-hosting.md](docs/self-hosting.md)
  y [docs/coolify.md](docs/coolify.md) describen la instancia del autor, con sus rutas y
  decisiones; sirven de modelo, no de receta.
- **Cron:** el recordatorio diario llama `POST /api/cron/notify-due` con `CRON_SECRET`, y las
  suscripciones de Outlook se renuevan con `POST /api/email-connection/renew`. Ver
  [docs/push-notifications.md](docs/push-notifications.md#agendarlo-en-railway).

### Railway: entornos de PR con datos falsos

Al arrancar, la imagen aplica las migraciones y corre `scripts/seed.ts`. La cuenta demo
(`demo@lucaplan.cl`) solo se siembra en un entorno de PR de Railway (`RAILWAY_ENVIRONMENT_NAME`
termina en `pr-<número>`) o en local con `NODE_ENV=development` contra `localhost`. En producción y
en Docker Compose se salta sin tocar la base. Es idempotente y hay una sola cuenta demo.
`SEED_PR_EMAIL` cambia su correo y `SEED_DEMO_FORCE=1` la rehace de cero. Cómo agregarle datos, en
[docs/development.md](docs/development.md#sembrar-los-datos-de-la-feature).

## Mapa documental

Este README es la **fuente canónica** del proyecto: lo leen personas, agentes, OpenSpec y Linear
antes de trabajar. Si dos fuentes se contradicen, manda el código y luego este README; se corrige
la fuente canónica primero y luego lo demás. `AGENTS.md` y `CLAUDE.md` solo apuntan aquí.

| Tema | Dónde |
| --- | --- |
| Producto y reglas de dominio | [docs/product.md](docs/product.md): usuarios, propósito, reglas del plan, principios de diseño y accesibilidad. |
| Arquitectura | [arch/clean-architecture.md](arch/clean-architecture.md): capas y regla de dependencias. |
| Desarrollo y contribución | [docs/development.md](docs/development.md): flujo de trabajo, Next 16, reglas de UI, seeds y verificaciones. |
| Design system | [docs/design/design-system.md](docs/design/design-system.md): tokens, vidrio, claro y oscuro. La fuente visual es [app/globals.css](app/globals.css). |
| Acceso por correo | [docs/login-code.md](docs/login-code.md): código de acceso, Resend y registro. |
| Outlook y Microsoft Graph | [docs/email-connection-outlook.md](docs/email-connection-outlook.md): webhook, renovación y recuperación. El paso a paso está [arriba](#conectar-outlook). |
| Correos bancarios | [docs/bank-email-contract.md](docs/bank-email-contract.md): correos soportados y qué debe aportar un banco nuevo. |
| Asistente MCP | [docs/plugin-luca-plan.md](docs/plugin-luca-plan.md): autorización, catálogo de operaciones y cómo conectarlo. |
| Reembolsos y presupuesto | [docs/reimbursement-budgets.md](docs/reimbursement-budgets.md): cómo un reembolso ajusta el tope. |
| Notificaciones push | [docs/push-notifications.md](docs/push-notifications.md): Web Push, eventos, umbrales y cron. |
| Operación y despliegue | [Scripts](#scripts) y [Despliegue](#despliegue) aquí; [docs/self-hosting.md](docs/self-hosting.md) y [docs/coolify.md](docs/coolify.md) para la instancia del autor. |
| Specs y cambios | [openspec/README.md](openspec/README.md): capacidades, cambios en curso e historial. Es historia, no contrato, y solo se usa si el mantenedor lo pide. |

## Contribuir

1. Haz fork y crea una rama desde `master`; los PR van contra `master`.
2. Lee [docs/development.md](docs/development.md).
3. Antes de abrir el PR: `pnpm lint && pnpm typecheck && pnpm test`.
4. Respeta la regla de dependencias de `arch/` y los primitivos de shadcn/ui; si falta un
   componente, instálalo con `pnpm dlx shadcn@latest add <componente>`.

## Licencia

[MIT](LICENSE): puedes usar, copiar, modificar y distribuir el software, incluso con fines
comerciales, siempre que incluyas el aviso de copyright y la licencia. Se entrega *tal cual*, sin
garantía.

---

<div align="center">

Hecho en Chile 🇨🇱 por [Welliton da Costa Prado](https://www.linkedin.com/in/welliton-da-costa-prado-5050b4251)

Privacidad conforme a la Ley 19.628 y preparada para la Ley 21.719 (Chile).

</div>
