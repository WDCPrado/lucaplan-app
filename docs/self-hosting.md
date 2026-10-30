# Luca Plan privado en Docker

`compose.production.yml` ejecuta una instancia personal separada del Compose de desarrollo:
PostgreSQL 18, app en modo producción, cron y Nginx para HTTPS. Cada servicio reinicia con
Docker (`unless-stopped`). PostgreSQL no publica puertos; la app solo publica `127.0.0.1:3005`
y Nginx publica `443` exclusivamente en la IP Tailscale del host.

## Preparación

1. Copia `.env.production.example` fuera del repositorio, por ejemplo a
   `C:/Users/welli/selfhost/lucaplan/production.env`. Completa `POSTGRES_PASSWORD` con un
   secreto hexadecimal aleatorio y `APP_ENV_FILE` con la ruta de ese mismo archivo.
2. Conserva de producción `BETTER_AUTH_SECRET`, **`BANCOCHILE_ENC_KEY`** y las claves VAPID,
   Outlook y OpenAI que utilices. Cambiar la llave de cifrado impide leer las conexiones
   importadas. No copies `RAILWAY_*`, `SEED_PR_*` ni actives `DEV_ANY_PASSWORD`.
3. Coloca un certificado TLS válido para `lucaplan.cl` en `TLS_CERT_DIR`: archivos
   `fullchain.pem` y `privkey.pem`. Emítelo y renuévalo mediante DNS-01, ya que el host es
   privado. La renovación automática se configura más abajo.
4. Configura el registro A de `lucaplan.cl` hacia `TAILSCALE_IP`, **DNS only**, sin proxy de
   Cloudflare. Elimina registros A/AAAA/CNAME incompatibles. Conserva los registros de correo.
   Los dispositivos necesitan Tailscale conectado y permisos de la tailnet para acceder.
5. Activa el inicio automático de Docker Desktop y Tailscale en Windows. Docker Desktop
   inicia al entrar en la sesión del usuario; `restart` no enciende Docker ni el PC. Si se
   requiere servicio antes del inicio de sesión, debe configurarse y probarse aparte.

Antes del corte, consulta `tailscale serve status`: Serve puede estar ocupando el puerto 443
que necesita Nginx. Conserva una copia de ese estado fuera del repo. Si el listener HTTPS 443
corresponde a esta misma app (`localhost:3005`), desactiva **solo ese listener** durante el corte
con `tailscale serve --https=443 off`, o reubícalo antes de arrancar Nginx. No uses un reset
global ni modifiques listeners de otras aplicaciones.

## Renovación automática del certificado

Conserva el directorio completo `letsencrypt` de Certbot en la carpeta de self-hosting,
junto a `certs`, `production.env` y un archivo `cloudflare.ini` con:

```ini
dns_cloudflare_api_token = TOKEN_CON_ZONE_DNS_EDIT_Y_ZONE_READ_SOLO_LUCAPLAN_CL
```

Restringe ese archivo al usuario que ejecuta Docker; no lo guardes en Git. El script
`scripts/renew-local-cert.ps1` corre `certbot/dns-cloudflare renew` con el autenticador
DNS de Cloudflare explícito en cada ejecución, incluso si el certificado se emitió primero
manualmente. Primero prueba el desafío DNS contra staging, sin copiar certificados ni recargar:

```powershell
./scripts/renew-local-cert.ps1 -SelfHostDirectory C:/Users/welli/selfhost/lucaplan -DryRun
```

Una vez que el dry-run pase y el proxy local esté funcionando, registra una tarea diaria y
al iniciar sesión, usando rutas absolutas desde el checkout que mantendrás para operar la app:

```powershell
$repo = (Get-Location).Path
$root = 'C:/Users/welli/selfhost/lucaplan'
$script = Join-Path $repo 'scripts/renew-local-cert.ps1'
$compose = Join-Path $repo 'compose.production.yml'
$arguments = '-NoProfile -NonInteractive -File "{0}" -SelfHostDirectory "{1}" -ComposeFile "{2}"' -f $script, $root, $compose
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$triggers = @((New-ScheduledTaskTrigger -Daily -At '12:00'), (New-ScheduledTaskTrigger -AtLogOn))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'LucaPlan-CertificateRenewal' -Action $action -Trigger $triggers -Settings $settings -Description 'Renueva TLS privado de Luca Plan mediante DNS-01'
Start-ScheduledTask -TaskName 'LucaPlan-CertificateRenewal'
Get-ScheduledTaskInfo -TaskName 'LucaPlan-CertificateRenewal'
```

Docker Desktop debe estar corriendo en esa sesión. Certbot solo renueva cuando corresponde.
El script toma una pareja de la misma versión desde `archive/lucaplan.cl`, evitando symlinks
Linux que Windows puede resolver mal. Si los PEM no cambiaron, no recarga. Si cambiaron,
valida con `nginx -t` antes de recargar; ante un fallo restaura ambos archivos anteriores
y devuelve error para que Windows reintente. Revisa el último resultado de la tarea:
un equipo apagado no puede renovar. El self-check sin Docker ni secretos se ejecuta con
`powershell -NoProfile -File scripts/renew-local-cert.test.ps1`.

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
docker compose --env-file $config -f compose.production.yml logs --tail 100 app cron proxy
```

La app aplica migraciones incrementales antes de servir. No se ejecuta un seed de datos reales;
el seed de PR se omite al no existir las variables de Railway. Valida login, cuentas y movimientos
en `https://lucaplan.cl`, con Tailscale conectado, antes de retirar definitivamente Railway.
Mantén respaldos externos del dump y de los secretos; el volumen persistente no es un backup.

## Cron y conexiones externas

El cron reutiliza la imagen de la app y ejecuta `scripts/sync-email.ts` cada cinco minutos y
`scripts/notify-due.ts` a las **00:00 UTC** (21:00 del día anterior en Chile durante UTC−3).
Las corridas son secuenciales y se cortan a los cuatro minutos si no terminan. Los fallos
quedan en los logs y se reintentan en la siguiente hora programada. Tras reiniciar, espera al
siguiente tick: no repite automáticamente un recordatorio diario perdido durante el apagado.

`sync-email.ts` usa `OUTLOOK_USER_ID` o el dueño del primer buzón activo: es la configuración
personal existente. Para revisar la sincronización manualmente:

```powershell
docker compose --env-file $config -f compose.production.yml exec app pnpm sync:email
```

Compose deja `OUTLOOK_WEBHOOK_URL` vacío. Microsoft Graph no puede llamar a una URL privada;
el polling recupera los cambios y no necesita renovar suscripciones públicas. El callback OAuth
conserva `https://lucaplan.cl/api/email-connection/callback`; el navegador que lo completa debe
estar conectado a Tailscale. Las notificaciones push salen hacia internet desde el host.

El endpoint MCP también queda privado: clientes cloud como ChatGPT no pueden alcanzarlo
directamente. El acceso desde clientes locales requiere conectividad a la tailnet.
