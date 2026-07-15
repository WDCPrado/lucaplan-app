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

Usa un secreto aleatorio independiente. El delta de Graph queda guardado como recuperación ante webhooks perdidos o repetidos; el botón “Sincronizar ahora” también ejecuta esa recuperación.

En desarrollo local deja `OUTLOOK_WEBHOOK_URL` vacío: el setup y la carga inicial siguen funcionando, pero la sincronización posterior será manual.
