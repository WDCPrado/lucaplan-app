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

3. Reinicia `pnpm dev`. En **Mi perfil → Notificaciones** aparece el switch; al activarlo llega una
   notificación de bienvenida que confirma el circuito completo en ese dispositivo.

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
| Movimientos nuevos         | Cuando el sync de correo importa cargos/abonos del banco. Uno se nombra; varios se resumen. Los movimientos **manuales no notifican**: el usuario acaba de crearlos. |
| Alerta de presupuesto      | Cuando ese movimiento hace **cruzar** el 80% o el 100% del límite global del mes. Al ser un cruce (antes debajo, después encima) no se repite ni hace falta guardar "ya avisé". |
| Pagos por vencer           | Recurrentes y cuotas que vencen en los próximos días. Lo dispara el cron `pnpm notify:due`. |

## Recordatorio de vencimientos (cron)

```bash
pnpm notify:due        # ventana por defecto: 2 días
pnpm notify:due 5      # ventana de 5 días
```

Pensado para **una corrida diaria** (ej. 9:00, con Task Scheduler o cron). Recorre a los usuarios
con al menos un dispositivo suscrito y envía una sola notificación con lo que vence. Correrlo más
seguido repite el mismo aviso.

## Piezas

| Pieza                          | Dónde                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| Puertos y tipos                | [arch/v1/domain/notifications/push.domain.ts](../arch/v1/domain/notifications/push.domain.ts) |
| Reglas de mensaje (puras)      | [arch/v1/application/notification-use-cases/notification-rules.ts](../arch/v1/application/notification-use-cases/notification-rules.ts) |
| Use-cases                      | `push-use-cases.ts` (alta/baja/envío), `notify-imported-use-case.ts` (correo + presupuesto), `notify-due-use-case.ts` (vencimientos) |
| Envío (VAPID + cifrado)        | [arch/v1/infrastructure/http/webpush/webpush.provider.ts](../arch/v1/infrastructure/http/webpush/webpush.provider.ts) |
| Suscripciones (Prisma)         | [arch/v1/infrastructure/database/prisma/push.infrastructure.ts](../arch/v1/infrastructure/database/prisma/push.infrastructure.ts) |
| Alta/baja HTTP                 | [app/api/push/route.ts](../app/api/push/route.ts)                     |
| `push` y `notificationclick`   | [public/sw.js](../public/sw.js)                                       |
| Switch de la UI                | [components/pwa/push-toggle.tsx](../components/pwa/push-toggle.tsx)    |

## Privacidad

De cada dispositivo se guarda solo lo imprescindible para entregarle el aviso: el endpoint del push
service y sus dos claves públicas (`push_subscription`). **El contenido de las notificaciones no se
persiste** y viaja cifrado de extremo a extremo: el push service (Google, Microsoft, Apple) no puede
leerlo.

Las suscripciones que el push service declara muertas (404/410) se borran solas en el siguiente
envío; apagar el switch da de baja el dispositivo en el acto.

## Problemas frecuentes

- **El switch no aparece** → faltan `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` en el entorno del servidor.
- **En iPhone dice que el navegador no permite notificaciones** → la app está abierta en una pestaña
  de Safari, no desde la pantalla de inicio.
- **Activé y no llegó la bienvenida** → la respuesta de `POST /api/push` trae `sent`; si es `0`, las
  claves VAPID no son válidas o no coinciden con las que usó el navegador al suscribirse (cambiaron
  después de suscribir: hay que apagar y volver a encender el switch).
- **Permiso denegado** → el navegador no vuelve a preguntar; hay que reactivarlo en los ajustes de
  notificaciones del sitio.
