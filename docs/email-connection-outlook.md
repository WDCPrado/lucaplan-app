# Conexión Outlook para Banco de Chile

Luca Plan usa Microsoft Graph con OAuth 2.0 Authorization Code + PKCE y solo solicita `Mail.Read`, `openid`, `profile`, `email` y `offline_access`. No puede enviar, modificar ni eliminar correos. El refresh token queda cifrado con AES-256-GCM y los cuerpos de los mensajes se procesan en memoria.

## Registro en Microsoft Entra

1. Crea un registro de aplicación que acepte **cuentas Microsoft personales**.
2. Agrega una plataforma **Web** con el redirect URI exacto de Luca Plan, por ejemplo `https://app.example.com/api/email-connection/callback`.
3. En permisos delegados de Microsoft Graph agrega `Mail.Read`. No agregues `Mail.ReadWrite` ni `Mail.Send`.
4. Crea un client secret para el servidor. Guárdalo únicamente en el gestor de secretos del despliegue.

Variables requeridas:

```env
OUTLOOK_CLIENT_ID=
OUTLOOK_CLIENT_SECRET=
OUTLOOK_TENANT=consumers
OUTLOOK_REDIRECT_URI=https://app.example.com/api/email-connection/callback
BANCOCHILE_ENC_KEY=
```

`BANCOCHILE_ENC_KEY` debe tener al menos 32 caracteres de alta entropía y debe respaldarse: si cambia, los tokens existentes dejan de poder descifrarse.

## Webhook y recuperación delta

El OAuth y el refresco manual funcionan sin webhook. Para sincronización automática, Microsoft exige una URL HTTPS accesible públicamente:

```env
OUTLOOK_WEBHOOK_URL=https://app.example.com/api/email-connection/webhook
OUTLOOK_RENEW_SECRET=
```

La ruta valida el desafío de Microsoft y el `clientState` de cada notificación. Configura el scheduler del despliegue para ejecutar cada 12 horas:

```sh
curl -X POST -H "Authorization: Bearer $OUTLOOK_RENEW_SECRET" https://app.example.com/api/email-connection/renew
```

Usa un secreto aleatorio independiente. No se sondea el correo cada cinco minutos: el delta
de Graph queda para recuperación manual con “Sincronizar”.

Un webhook válido responde `202` apenas se valida y el correo se procesa después:
Microsoft corta a los pocos segundos, y procesar antes de responder lo hacía reintentar en vez
de entregar. Avisos que llegan juntos esperan su turno (hasta dos minutos). Si el
procesamiento falla, el buzón queda en error con su aviso; el delta no avanzó, así que
“Sincronizar” trae lo que faltó sin duplicar.
No se puede detectar ni garantizar recuperación automática de una notificación que nunca llegó.

Los fallos detectados en webhook o renovación se muestran en la conexión de Outlook y
envían un push a los dispositivos suscritos, una vez por incidente. Los errores transitorios
permiten reintentar; una autorización vencida o revocada pide **Reconectar**. Un éxito limpia
el aviso y un fallo posterior abre otro incidente. El push es best-effort; el aviso dentro
de la app permanece aunque el dispositivo no reciba la notificación. No se guardan ni envían
mensajes de error del proveedor, tokens o contenido de correo.

En desarrollo local deja `OUTLOOK_WEBHOOK_URL` vacío: el setup y la carga inicial siguen funcionando, pero la sincronización posterior será manual.
