# Luca Plan en Docker con Cloudflare Tunnel

`compose.production.yml` ejecuta una instancia separada del Compose de desarrollo:
PostgreSQL 18, app en modo producción, cron y un túnel propio de Cloudflare. Cada servicio
reinicia con Docker (`unless-stopped`). PostgreSQL no publica puertos; la app publica solo
`127.0.0.1:3005` para diagnóstico local. Cloudflare sirve `https://lucaplan.cl` públicamente
y el túnel se conecta a `http://app:3005` dentro de la red privada de este Compose.

## Preparación

1. Copia `.env.production.example` fuera del repositorio, por ejemplo a
   `C:/Users/welli/selfhost/lucaplan/production.env`. Completa `POSTGRES_PASSWORD` con un
   secreto hexadecimal aleatorio y `APP_ENV_FILE` con la ruta de ese mismo archivo.
2. Conserva de producción `BETTER_AUTH_SECRET`, **`BANCOCHILE_ENC_KEY`**,
   `OUTLOOK_RENEW_SECRET` y las claves VAPID, Outlook y OpenAI que utilices. Cambiar la llave
   de cifrado impide leer las conexiones importadas. No copies `RAILWAY_*`, `SEED_PR_*`
   ni actives `DEV_ANY_PASSWORD`.
3. Conserva **`NEXT_PUBLIC_LANDING_ONLY=true`**, como en Railway: el registro sigue cerrado.
   Compose pasa el mismo valor al build del frontend y al backend en ejecución. Después de
   cambiarlo debes reconstruir la imagen; reiniciar solo el contenedor no actualiza el frontend.
4. Crea un túnel Cloudflare para Luca Plan, independiente del de Pomodoro. Configura su
   hostname público `lucaplan.cl` hacia `http://app:3005`, seguido del fallback `http_status:404`.
   Guarda únicamente el token del túnel en el archivo que indica
   `CLOUDFLARE_TUNNEL_TOKEN_FILE`, fuera del repositorio. Compose lo monta como un secreto
   de archivo; no se incluye en la imagen ni en el comando del contenedor.
5. Durante el corte, reemplaza el registro de Railway por el CNAME de ese túnel,
   `<id-del-tunel>.cfargotunnel.com`, con proxy Cloudflare activado. Conserva los registros
   de correo. Cloudflare gestiona HTTPS; no se abren puertos del router.
6. Activa el inicio automático de Docker Desktop en Windows. Docker Desktop inicia al
   entrar en la sesión del usuario; `restart` no enciende Docker ni el PC. Si se requiere
   servicio antes del inicio de sesión, debe configurarse y probarse aparte.

El túnel publica la app completa, incluidos el webhook de Outlook y MCP. La autenticación
existente sigue controlando las funciones de cada usuario. El bucket de Pomodoro y las bases
de ambas aplicaciones no comparten esta red ni este túnel.

## Migración y primer arranque

Antes de copiar los datos, detén las escrituras de la instancia anterior (app y cron),
retira sus dominios y conserva un dump y las variables de producción fuera del repositorio.
No uses `setup:db` ni `clone:db` contra esta instancia: son utilidades destructivas para dev.

```powershell
$config = 'C:/Users/welli/selfhost/lucaplan/production.env'
docker volume create lucaplan-production-pgdata
docker compose --env-file $config -f compose.production.yml up -d postgres
```

Restaura el dump de PostgreSQL 18 en la base `lucaplan`, usuario `lucaplan`, dentro del servicio
`postgres`, sin owners/privilegios de Railway (`pg_restore --no-owner --no-acl`). Verifica tablas,
conteos y datos antes de arrancar la app. El volumen es externo: Compose no lo elimina incluso
con `down -v`. No reutiliza ni modifica los volúmenes anteriores de desarrollo.

```powershell
docker compose --env-file $config -f compose.production.yml up -d --build
docker compose --env-file $config -f compose.production.yml ps
docker compose --env-file $config -f compose.production.yml logs --tail 100 app cron tunnel
```

La app aplica migraciones incrementales antes de servir. El seed de PR se omite al no existir
las variables de Railway. Valida login, cuentas, movimientos y conexión de correo en
`https://lucaplan.cl` antes de retirar definitivamente Railway. Mantén respaldos externos del
dump y de los secretos; el volumen persistente no es un backup.

## Cron y Outlook

El cron reutiliza la imagen de la app:

- `scripts/sync-email.ts` cada cinco minutos, como respaldo de los webhooks.
- `scripts/notify-due.ts` a las **00:00 UTC** (21:00 del día anterior en Chile durante UTC−3).
- `POST http://app:3005/api/email-connection/renew` a las **00:00 y 12:00 UTC**, usando
  `OUTLOOK_RENEW_SECRET` como Bearer. Detecta errores HTTP y renovaciones parciales fallidas
  sin registrar el secreto ni respuestas del proveedor.

Las corridas son secuenciales y se cortan a los cuatro minutos si no terminan. Los fallos quedan
en los logs y se reintentan en el siguiente horario programado. Tras reiniciar, espera al
siguiente tick: no repite automáticamente trabajos perdidos durante el apagado.

`sync-email.ts` usa `OUTLOOK_USER_ID` o el dueño del primer buzón activo: es la configuración
personal existente. Para revisar la sincronización manualmente:

```powershell
docker compose --env-file $config -f compose.production.yml exec app pnpm sync:email
```

Compose conserva el callback `https://lucaplan.cl/api/email-connection/callback` y el webhook
`https://lucaplan.cl/api/email-connection/webhook`. Las notificaciones push y las llamadas a
Microsoft Graph salen hacia internet desde el host. Las suscripciones y los datos reales se
verifican después del corte; los tests del repo no sustituyen esa prueba.
