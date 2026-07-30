# Notificaciones push

Luca Plan usa **Web Push estándar** (VAPID + RFC 8291). Una sola implementación cubre los tres
destinos: **Android** (Chrome/Edge), **Windows** (Chrome/Edge, con o sin instalar) y **iOS/iPadOS
16.4+**, donde Apple exige que la PWA esté **añadida a la pantalla de inicio**.

No hay servicio de terceros ni SDK: el servidor firma con sus claves VAPID y cifra el payload
contra las claves del dispositivo. Sin claves configuradas la app funciona igual, simplemente no
ofrece ni envía notificaciones.

## Configuración

1. Genera el par de claves **una vez** (se reutiliza en todos los entornos que compartan usuarios;
   si cambian, las suscripciones existentes dejan de recibir y hay que volver a activarlas):

   ```bash
   pnpm exec web-push generate-vapid-keys
   ```

2. Pásalas al `.env`:

   ```env
   VAPID_PUBLIC_KEY="B..."
   VAPID_PRIVATE_KEY="..."
   VAPID_SUBJECT="mailto:tu@correo.com"
   ```

3. Reinicia `pnpm dev`. En **Configuración → Notificaciones** aparece el botón *Activar
   notificaciones*; al pulsarlo llega una notificación de bienvenida que confirma el circuito
   completo en ese dispositivo.

Mientras el dispositivo no tenga notificaciones configuradas, al entrar al dashboard se ofrece
activarlas en un modal. Solo aparece si el navegador las soporta y el permiso sigue **sin decidir**:
una vez concedido o denegado el navegador ya no vuelve a preguntar, así que el aviso solo estorbaría
— desde ahí se gestiona en Configuración. "Ahora no" no recuerda nada: si el dispositivo sigue sin
configurar, se vuelve a ofrecer la próxima vez.

> La clave **pública** llega al navegador como prop del server component (`app/profile/page.tsx`);
> no hace falta duplicarla en un `NEXT_PUBLIC_*`. La **privada** nunca sale del servidor.

## Requisitos por plataforma

| Plataforma        | Requisito                                                                 |
| ----------------- | ------------------------------------------------------------------------- |
| Android           | Chrome/Edge. Funciona en pestaña; instalada se comporta como app nativa.  |
| Windows           | Chrome/Edge. Las notificaciones salen por el centro de notificaciones.    |
| iOS / iPadOS      | **16.4+** y la PWA **añadida a la pantalla de inicio** (Compartir → Añadir a pantalla de inicio). En una pestaña de Safari `PushManager` no existe y el switch avisa. |
| Todas             | **HTTPS** (o `localhost` en desarrollo) y el permiso concedido en un gesto del usuario. |

## Qué se notifica

| Evento                     | Cuándo                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| Movimientos nuevos         | Cuando el sync de correo importa cargos/abonos del banco. Uno se nombra con su categoría (`$12.990 · Uber Eats · Comida`; sin clasificar, se omite); varios se resumen. Los movimientos **manuales no notifican**: el usuario acaba de crearlos. |
| Alerta de presupuesto      | Cuando un gasto hace que **una categoría** cruce alguno de los porcentajes configurados de **su** límite del mes: al importarlo, o al **categorizarlo** (sin categoría no cuenta para el presupuesto, igual que en el resumen). Al ser un cruce (antes debajo, después encima) no se repite ni hace falta guardar "ya avisé". Si un gasto cruza varios umbrales de una vez, avisa **solo el más alto**. |
| Pagos por vencer           | Recurrentes y cuotas que vencen dentro de la ventana configurada (**Configuración → Pagos por vencer**, 0–14 días). Lo dispara el cron `pnpm notify:due`. |

## Umbrales de presupuesto configurables

Viven en la tabla `budget_alert` y se editan en **Configuración → Alertas de presupuesto**, con un
slider por umbral (5–100%, en pasos de 5). Puedes tener **los que quieras**: 50%, 80%, 100%…
La migración siembra 80% y 100%, que eran los valores fijos anteriores.

Los umbrales son **globales en el sentido de que valen para todas las categorías**, pero cada una los
mide contra **su propio límite** del mes (`category_limit`, con carry-forward). Gastar el 80% de
Comida avisa "Comida: vas en el 80% del presupuesto", aunque el total del mes vaya en el 30%. Una
categoría sin límite (o en 0) nunca alerta: no hay porcentaje que cruzar. Las categorías de ingreso
tampoco.

El umbral es el **gatillo**; lo que el aviso dice es el gasto **real**: saltar de 40% a 139% con un
umbral en 80 titula "Comida: te pasaste, vas en el 139%", no "vas en el 80%". Justo en el 100% es
"Comida: presupuesto completo". Por eso el techo del slider es 100: sobre eso el número ya lo pone
el gasto, no la configuración.

Cada aviso viaja con `tag: budget:<id>` y el service worker muestra con `renotify: true`: la
notificación de una categoría se reemplaza en vez de apilarse, pero **vuelve a sonar**. Sin
`renotify` el reemplazo es mudo y parece que la app no avisó.

La tabla es **global a propósito**: sin `userId` ni mes. Es una preferencia de la app, no un dato
financiero de un usuario o un período. El `percent` es único — dos alertas iguales avisarían dos
veces lo mismo, así que se rechaza con 409.

Sin ningún umbral configurado no se envía ninguna alerta de presupuesto (los movimientos nuevos y
los vencimientos siguen avisando).

El cruce lo evalúa `notifyBudgetCrossing`
([notify-imported-use-case.ts](../arch/v1/application/notification-use-cases/notify-imported-use-case.ts)):
revisa **solo las categorías que tocó** el cambio (el resto no se movió), suma el gasto del mes de
cada una y deriva el "antes" excluyendo los movimientos que acaban de entrar (el lote importado, o el
que se acaba de categorizar en
[/api/transactions/[id]/category](../app/api/transactions/[id]/category/route.ts)). Mover un gasto de
una categoría a otra sí evalúa la **nueva** (su gasto subió). Cada aviso usa `tag: budget:<id>`, así
dos categorías no se pisan. Propagar una categoría a todos los movimientos con el mismo texto **no**
dispara alertas.

Categorizar solo alerta si el movimiento es del **mes en curso**: el triage del onboarding clasifica
tres meses de historial y avisar del presupuesto de un mes pasado sería ruido. El import inicial
(`confirmSetup`) tampoco notifica: solo el sync incremental llama al hook.

## Recordatorio de vencimientos (cron)

```bash
pnpm notify:due        # ventana configurada en Configuración → Pagos por vencer
pnpm notify:due 5      # ventana de 5 días (puntual, ignora la configuración)
```

Pensado para **una corrida diaria** (ej. 9:00). Recorre a los usuarios con al menos un dispositivo
suscrito y envía una sola notificación con lo que vence. Correrlo más seguido repite el mismo aviso.
Nadie lo llama solo: sin un scheduler configurado, **este aviso no sale nunca**.

### Agendarlo en Railway

El despliegue usa un **servicio cron aparte** (`function-bun`) que golpea la app por HTTP. La app no
se agenda sola: `next start` nunca termina, así que no puede ser su propio cron.

Endpoints que expone, ambos con secreto Bearer y sin sesión de usuario:

| Endpoint                            | Qué hace                                    | Secreto                 |
| ----------------------------------- | ------------------------------------------- | ----------------------- |
| `POST /api/cron/notify-due`         | Recordatorio de vencimientos a los suscritos | `CRON_SECRET`           |
| `POST /api/email-connection/renew`  | Renueva las suscripciones de Graph           | `OUTLOOK_RENEW_SECRET`  |

Código del servicio cron (Bun). **Sin `Bun.serve`**: un cron job debe terminar, no quedarse
escuchando — si sigue vivo, Railway se salta la corrida siguiente.

```ts
// index.ts — cron diario de Luca Plan. Llama, reporta y termina.
const BASE = process.env.APP_URL ?? "https://lucaplan.cl"

async function call(path: string, secret: string | undefined, label: string) {
  if (!secret) {
    console.log(`${label}: sin secreto configurado, omitido`)
    return true
  }
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    })
    console.log(`${label}: ${res.status} ${await res.text()}`)
    return res.ok
  } catch (e) {
    console.error(`${label}: falló`, (e as Error).message)
    return false
  }
}

const resultados = [
  await call("/api/cron/notify-due", process.env.CRON_SECRET, "vencimientos"),
  await call("/api/email-connection/renew", process.env.OUTLOOK_RENEW_SECRET, "renovación Outlook"),
]
// Exit ≠ 0 marca la corrida como fallida en Railway (queda visible en Cron Runs).
process.exit(resultados.every(Boolean) ? 0 : 1)
```

Variables del servicio cron: `APP_URL`, `CRON_SECRET`, `OUTLOOK_RENEW_SECRET` — los dos secretos con
el MISMO valor que en el servicio web. Horario: Railway usa **UTC**, así que `0 13 * * *` son las
9:00 en Chile en invierno (UTC−4) y `0 12 * * *` en verano (UTC−3). El `Daily` por defecto
(`0 0 * * *`) avisa a las 20:00 hora local.

`pnpm notify:due` sigue existiendo para probar a mano desde la consola; hace exactamente la misma
pasada que el endpoint. Los scripts usan `--env-file-if-exists=.env` para no morir con ENOENT donde
no hay archivo `.env`.

La anticipación (0–14 días, 0 = el mismo día del cobro) vive en `app_setting.due_days` y se edita
con un slider en **Configuración → Pagos por vencer**
([due-reminder.domain.ts](../arch/v1/domain/notifications/due-reminder.domain.ts) +
[/api/due-reminder](../app/api/due-reminder/route.ts)). El script la lee en cada corrida, así que
cambiarla no exige tocar el cron; el argumento posicional sigue mandando para pruebas puntuales.

## Piezas

| Pieza                          | Dónde                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| Puertos y tipos                | [arch/v1/domain/notifications/push.domain.ts](../arch/v1/domain/notifications/push.domain.ts) |
| Reglas de mensaje (puras)      | [arch/v1/application/notification-use-cases/notification-rules.ts](../arch/v1/application/notification-use-cases/notification-rules.ts) |
| Umbrales configurables         | [budget-alert.domain.ts](../arch/v1/domain/notifications/budget-alert.domain.ts) + [budget-alert-use-cases.ts](../arch/v1/application/notification-use-cases/budget-alert-use-cases.ts) |
| Anticipación de vencimientos   | [due-reminder.domain.ts](../arch/v1/domain/notifications/due-reminder.domain.ts) + [due-reminder-use-cases.ts](../arch/v1/application/notification-use-cases/due-reminder-use-cases.ts) |
| Use-cases                      | `push-use-cases.ts` (alta/baja/envío), `notify-imported-use-case.ts` (correo + presupuesto), `notify-due-use-case.ts` (vencimientos) |
| Envío (VAPID + cifrado)        | [arch/v1/infrastructure/http/webpush/webpush.provider.ts](../arch/v1/infrastructure/http/webpush/webpush.provider.ts) |
| Suscripciones (Prisma)         | [arch/v1/infrastructure/database/prisma/push.infrastructure.ts](../arch/v1/infrastructure/database/prisma/push.infrastructure.ts) |
| Alta/baja HTTP                 | [app/api/push/route.ts](../app/api/push/route.ts); umbrales en [app/api/budget-alerts/route.ts](../app/api/budget-alerts/route.ts) |
| `push` y `notificationclick`   | [public/sw.js](../public/sw.js)                                       |

## A dónde lleva cada aviso

| Aviso                      | Destino                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| Movimiento nuevo (uno)     | `/dashboard?tx=<id>` — abre el modal de ESE movimiento                   |
| Movimientos nuevos (varios)| `/dashboard`                                                             |
| Alerta de presupuesto      | `/dashboard`                                                             |
| Pagos por vencer           | `/installments` si todo lo que vence son cuotas; si no, `/recurring`     |

El `notificationclick` del service worker **navega** la ventana existente a esa URL en vez de solo
enfocarla: con la PWA ya abierta en `/dashboard`, un simple `focus()` dejaba el enlace sin efecto.
Si `navigate` falla (ventana de otro contexto), abre una nueva.

El deep link lo resuelve el dashboard sin `useEffect`: `?tx=` llega como prop desde el server
component y el estado se ajusta en render (patrón de React para props que cambian), así tocar otra
notificación con la app abierta cambia de movimiento. Al cerrar el modal se limpia el query para que
recargar no lo reabra. Un movimiento fuera del mes en curso no está en la lista cargada: el aviso
abre el dashboard sin modal en vez de fallar.
| UI                             | [push-toggle.tsx](../components/pwa/push-toggle.tsx) (botón), [push-prompt.tsx](../components/pwa/push-prompt.tsx) (modal de entrada), [settings-view.tsx](../components/finance/settings-view.tsx) (pestaña Configuración) |
| Alta/baja en el navegador      | [lib/push.ts](../lib/push.ts) — permiso, suscripción y baja; lo comparten el botón y el modal |

## Privacidad

De cada dispositivo se guarda solo lo imprescindible para entregarle el aviso: el endpoint del push
service y sus dos claves públicas (`push_subscription`). **El contenido de las notificaciones no se
persiste** y viaja cifrado de extremo a extremo: el push service (Google, Microsoft, Apple) no puede
leerlo.

Las suscripciones que el push service declara muertas (404/410) se borran solas en el siguiente
envío; apagar el botón da de baja el dispositivo en el acto.

El `endpoint` es una URL que propone el cliente y a la que el servidor hará POST en cada envío, así
que solo se aceptan los **hosts de push services conocidos** (`isAllowedPushEndpoint` en
[push.domain.ts](../arch/v1/domain/notifications/push.domain.ts)): sin esa lista, cualquiera con
sesión podría apuntar el endpoint a un host interno y usar la app como proxy (SSRF). Se valida al
dar de alta **y** antes de cada envío. Si algún navegador nuevo usa otro push service, se agrega su
dominio a esa lista.

## Problemas frecuentes

- **El botón no aparece** → faltan `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` en el entorno del servidor.
- **En iPhone dice que el navegador no permite notificaciones** → la app está abierta en una pestaña
  de Safari, no desde la pantalla de inicio.
- **Activé y no llegó la bienvenida** → la respuesta de `POST /api/push` trae `sent`; si es `0`, las
  claves VAPID no son válidas o no coinciden con las que usó el navegador al suscribirse (cambiaron
  después de suscribir: hay que apagar y volver a encender el switch).
- **Permiso denegado** → el navegador no vuelve a preguntar; hay que reactivarlo en los ajustes de
  notificaciones del sitio.
