# Luca Plan en Docker con Cloudflare Tunnel

La producción migrada a Coolify usa la [guía de Coolify](coolify.md) y `compose.coolify.yml`.
Este documento conserva la instalación de Docker Desktop y su recuperación. El workflow actual
ya no llama a `deploy-local.mjs`: no reactives su runner durante la operación de Coolify.

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
   ni configuración de pruebas. Para entrar por código, configura también `RESEND_API_KEY`
   y, opcionalmente, `RESEND_FROM` en ese archivo externo (ver [acceso por correo](login-code.md)).
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
conteos y datos antes de arrancar la app. El volumen es externo y no comparte datos con desarrollo. No uses `down -v` ni comandos
para eliminar volúmenes en esta instancia.

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

## Despliegue local anterior al migrar a Coolify

Antes de la migración, el workflow `Validate PR` validaba primero el código en GitHub. Su job `deploy` corría **solo**
para un `push` a `master` de este repositorio y después de que `validate` termine bien. Un PR
abierto o cerrado sin merge no ejecuta código en el equipo de producción. También despliega
un push directo autorizado a `master`; usa la protección de rama para exigir PR si corresponde.
El runner hace una conexión saliente a GitHub: Cloudflare Tunnel sigue sirviendo la app y no
necesita un webhook público nuevo.

### Instalar el runner una vez

1. En GitHub, **Settings → Actions → Runners → New self-hosted runner**, elige Windows x64.
   Instala siguiendo los comandos que muestra GitHub, fuera del repositorio y del directorio
   checkout. Ya está instalado como `lucaplan-local-windows` en `C:/Users/welli/selfhost/lucaplan/actions-runner`: no crees otro. Usa la etiqueta
   **`lucaplan-production`**. El repositorio debe seguir siendo privado; un runner con acceso
   a Docker y secretos no debe aceptar código de contribuidores no confiables.
2. Usa la cuenta Windows que ya accede a Docker Desktop. El proceso necesita Git, Node **24**
   y Docker Compose v2 en PATH; el workflow usa Windows PowerShell, no requiere `pwsh`.
   Configura `LUCA_RUNTIME_DIR=C:/Users/welli/selfhost/lucaplan` en el entorno del runner antes
   de arrancarlo. Ese directorio conserva `compose.json`, `production.env` y los secretos.
3. Mantén `last-deploy.json` con `commit` (SHA completo de la versión realmente desplegada)
   e `image`. En el primer run el script comprueba que app y cron estén ejecutando el ID de
   esa imagen. No inicialices ese registro con el SHA del nuevo PR: representa la versión
   anterior. Después se usa `deploy-state.json`, con SHA e imagen por servicio.
4. Arranca el runner con la sesión del usuario que ejecuta Docker Desktop. La instalación
   actual usa la tarea de Windows **`LucaPlan-GitHub-Runner`**, al iniciar sesión, con la cuenta
   `PCWILLY\welli`, sin elevar privilegios. No es un servicio. Su archivo `.env` define
   `LUCA_RUNTIME_DIR`. Docker Desktop debe estar listo antes de un despliegue; runner y tarea
   no encienden el daemon ni el PC. Si Docker todavía no responde, reintenta el job una vez listo.

Una ejecución se puede reintentar desde **Actions → Validate PR → Re-run failed jobs**.
El job serializa despliegues con `queue: max`, conservando los pendientes aunque CI termine fuera de orden; el script tiene además `deploy.lock`. No cancela el despliegue
activo por un merge nuevo. Si el SHA ya no es el último `master`, se omite; el próximo run
validado compara contra el último estado confirmado, incluyendo todos los cambios pendientes.
Si el último CI falla, se conserva la versión desplegada hasta corregirlo o revertirlo.

### Watch paths

| Cambios | Servicios que se reconstruyen/recrean |
| --- | --- |
| `app/`, `components/`, `hooks/`, `public/`, configuración Next/PostCSS | `app` |
| `scripts/local-cron.mjs`, `scripts/sync-email.ts`, `scripts/notify-due.ts` | `cron` |
| `arch/`, `lib/`, Prisma, Dockerfile, dependencias y otras rutas de runtime | `app` y `cron` |
| Documentación, OpenSpec, tests, workflow y script de despliegue | Ninguno |
| `compose.production.yml` | Se detiene para sincronización manual del manifiesto externo |

La imagen se construye una vez por SHA y solo se asigna a los servicios afectados. App y cron
pueden conservar imágenes distintas si el cambio solo toca uno. Los cambios de archivos
borrados o movidos también se consideran. Las rutas desconocidas actualizan ambos por seguridad.
Modificar el script de despliegue o el workflow surte efecto en la siguiente ejecución sin
necesitar reconstruir la app. Los tests siguen corriendo en CI aunque no provoquen despliegue.

El build termina antes de tocar contenedores. Antes de recrear app, se guarda un dump PostgreSQL
en `LUCA_RUNTIME_DIR/backups` y se comprueba su catálogo con `pg_restore --list` (esto no es una
prueba de restauración). Si hay migraciones, se detiene cron hasta que app esté saludable.
PostgreSQL y el túnel no se recrean. Los backups e imágenes anteriores se conservan: controla
el espacio en disco y aplica tu política de retención fuera de este script.

`deploy-images.json` es un override **solo de imágenes**, externo al repositorio. A partir del
primer despliegue, inclúyelo al operar manualmente, para no volver a la imagen de `compose.json`:

```powershell
$runtime = 'C:/Users/welli/selfhost/lucaplan'
docker compose -p lucaplan-production --env-file "$runtime/production.env" -f "$runtime/compose.json" -f "$runtime/deploy-images.json" ps
```

App espera su healthcheck HTTP; cron comprueba que el proceso esté `running`, no que haya
sincronizado correos. Revisa sus logs después del siguiente intervalo. El SHA por servicio
queda en `deploy-state.json`, el último resultado en `last-auto-deploy.json` y la ejecución
en Actions. No se imprimen variables de producción.

### Fallos y recuperación

Un fallo de build o backup deja los contenedores intactos. Un fallo al recrear puede dejar app
en error y cron detenido si había migraciones: **no se confirma el SHA** ni se restaura la base
automáticamente. Antes de reintentar, revisa logs y compatibilidad del esquema. El script
rechaza un runtime cuya imagen no coincida con el estado confirmado, para no ocultar un
despliegue incompleto.

`deploy-previous.json` conserva las imágenes anteriores y `deploy-previous-state.json` su estado.
Si el esquema sigue compatible, recupera las imágenes anteriores:

```powershell
$runtime = 'C:/Users/welli/selfhost/lucaplan'
docker compose -p lucaplan-production --env-file "$runtime/production.env" -f "$runtime/compose.json" -f "$runtime/deploy-previous.json" up -d --no-deps --wait app
if ($LASTEXITCODE -ne 0) { throw 'No se recuperó app; no arrancar cron.' }
docker compose -p lucaplan-production --env-file "$runtime/production.env" -f "$runtime/compose.json" -f "$runtime/deploy-previous.json" up -d --no-deps --wait cron
if ($LASTEXITCODE -ne 0) { throw 'No se recuperó cron.' }
Copy-Item -LiteralPath "$runtime/deploy-previous.json" -Destination "$runtime/deploy-images.json"
Copy-Item -LiteralPath "$runtime/deploy-previous-state.json" -Destination "$runtime/deploy-state.json"
```

Revisa luego login y datos. Si Windows se apagó durante el deploy, verifica que no haya un
proceso activo, recupera el runtime y elimina únicamente `deploy.lock` antes de reintentar.
Nunca restaures un dump automáticamente sobre escrituras posteriores.

Si cambió `compose.production.yml`, sincroniza el manifiesto externo conservando secretos,
volúmenes, puertos y proyecto; realiza el despliegue manual completo del SHA validado y comprueba
ambos servicios. Luego actualiza `deploy-state.json` con ese SHA e imagen para **ambos** servicios
y `deploy-images.json` con esas imágenes. No avances el estado solo para saltarte el bloqueo.

## Después de mergear un PR: actualizar Docker local

Este procedimiento manual sirve para sincronizar un cambio de Compose o recuperar una instalación.
Detén temporalmente el runner para no solapar la operación con Actions. No ejecutes este paso
mientras el PR sigue en revisión: usa un checkout limpio del SHA mergeado y validado de `master`.

El runtime usa `C:/Users/welli/selfhost/lucaplan/compose.json` y `production.env`, proyecto
`lucaplan-production` y volumen externo `lucaplan-production-pgdata`. Ese JSON no tiene build.
Si cambió Compose, sincronízalo conservando secretos, puertos, mounts, volúmenes y proyecto.
Antes de actualizar guarda un backup PostgreSQL verificable fuera del repo y preserva las
imágenes/estado actuales para rollback. Revisa compatibilidad de las migraciones con la versión
anterior. El ejemplo usa `NEXT_PUBLIC_LANDING_ONLY=true`; conserva el valor real del runtime.

```powershell
$runtime = 'C:/Users/welli/selfhost/lucaplan'
$sha = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[a-f0-9]{40}$') { throw 'SHA inválido.' }
$image = "lucaplan-local:$sha"
$compose = @('compose', '-p', 'lucaplan-production', '--env-file', "$runtime/production.env", '-f', "$runtime/compose.json")
docker @compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Manifiesto runtime inválido.' }
docker build --build-arg NEXT_PUBLIC_LANDING_ONLY=true --label "org.opencontainers.image.revision=$sha" -t $image .
if ($LASTEXITCODE -ne 0) { throw 'Build falló; no recrear contenedores.' }
$utf8 = New-Object System.Text.UTF8Encoding($false)
$images = @{ services = @{ app = @{ image = $image }; cron = @{ image = $image } } }
[IO.File]::WriteAllText("$runtime/deploy-candidate.json", ($images | ConvertTo-Json -Depth 5), $utf8)
docker @compose stop cron
if ($LASTEXITCODE -ne 0) { throw 'No se detuvo cron.' }
docker @compose -f "$runtime/deploy-candidate.json" up -d --no-deps --wait app
if ($LASTEXITCODE -ne 0) { throw 'App no está saludable; revisar recuperación.' }
docker @compose -f "$runtime/deploy-candidate.json" up -d --no-deps --wait cron
if ($LASTEXITCODE -ne 0) { throw 'Cron no arrancó; revisar recuperación.' }
```

Verifica login, continuidad de los datos, túnel y logs de cron. Coteja los IDs de imagen de los
dos contenedores con el build. Solo después confirma el override y el estado:

```powershell
Copy-Item -LiteralPath "$runtime/deploy-candidate.json" -Destination "$runtime/deploy-images.json"
$state = @{ app = @{ sha = $sha; image = $image }; cron = @{ sha = $sha; image = $image } }
[IO.File]::WriteAllText("$runtime/deploy-state.json", ($state | ConvertTo-Json -Depth 5), $utf8)
```

Reanuda el runner. Si falla, recupera las imágenes y el estado preservados según la sección
anterior, comprobando compatibilidad del esquema. No restaures un dump encima de escrituras
nuevas automáticamente. Nunca uses `down -v`, `docker volume rm`, `prisma migrate reset`,
`setup:db`, `clone:db` ni seeds sobre producción para actualizar una imagen.
