# Luca Plan con recursos nativos de Coolify

Configuración para **Coolify 4.5.3** en Ubuntu 24.04 WSL2 con Docker Engine propio,
separado de Docker Desktop. Coolify administra la aplicación Git/Dockerfile,
PostgreSQL 18 nativo, Scheduled Tasks y un servicio Cloudflare Tunnel independiente.
El origen de Desktop queda detenido después del corte, conservando sus datos.

## Aplicación y PostgreSQL

1. Crea PostgreSQL nativo con imagen `postgres:18-alpine`, base y usuario `lucaplan`.
   PostgreSQL 18 guarda datos bajo `/var/lib/postgresql`: confirma el montaje
   persistente del recurso antes de restaurar. No publiques su puerto. Conserva el
   volumen asignado por Coolify; no necesita tener el nombre del volumen de Desktop.
2. Restaura el dump verificado en esa base vacía. Los daemons son independientes;
   crear un recurso o volumen no importa los datos del origen. Copia la **Internal
   URL** del recurso PostgreSQL en `DATABASE_URL` de la aplicación, solo runtime.
   App y base deben compartir la red/destino interno de Coolify; comprueba DNS y
   conexión antes de abrir tráfico. No uses el antiguo hostname `postgres` por suposición.
3. Crea la Application del repositorio privado `WDCPrado/lucaplan-app`, rama `master`,
   build pack **Dockerfile**, Base Directory `/`, Dockerfile `/Dockerfile`, puerto
   expuesto `3005` y Domains `https://lucaplan.cl:3005` (el puerto indica el destino
   interno del proxy, no un puerto público). Usa GitHub App o deploy key de solo lectura. Desactiva Auto Deploy
   y previews desde el principio. No configures Compose ni comandos Compose custom.
4. Configura healthcheck HTTP `/login`, puerto `3005`, con tiempo de inicio suficiente
   para las migraciones. Conserva el CMD del Dockerfile: aplica migraciones pendientes
   y arranca Next. No añadas variables `RAILWAY_*`, `SEED_PR_*` ni datos demo.
5. Copia los secretos actuales: `BETTER_AUTH_SECRET`, `BANCOCHILE_ENC_KEY`, Resend,
   Outlook y VAPID. Conserva `BETTER_AUTH_URL=https://lucaplan.cl`, callback y webhook
   públicos actuales. `NEXT_PUBLIC_LANDING_ONLY=true` va a build y runtime; los demás
   secretos solo a runtime. No imprimas URLs de base ni respuestas API completas.
6. Coolify usa el commit fijado para construir y etiquetar la imagen nativa. Registra
   el SHA efectivo de cada despliegue y conserva imágenes anteriores. No sustituyas
   el pin por `HEAD` ni habilites despliegues independientes desde GitHub App.

La base es independiente: desplegar la aplicación no la recrea. Un despliegue nativo
puede mantener la versión anterior mientras arranca la nueva; las migraciones deben
ser compatibles con ambas. Para cambios incompatibles, detén tareas y escrituras en
una ventana de mantenimiento y prepara recuperación explícita antes del despliegue.

## Trabajos periódicos nativos

En la Application configura **Scheduled Tasks** con timezone del servidor **UTC**:

| Comando dentro del contenedor | Cron UTC | Propósito |
| --- | --- | --- |
| `node /app/scripts/sync-email.ts` | `*/5 * * * *` | Sincronizar correo |
| `node /app/scripts/notify-due.ts` | `0 0 * * *` | Recordatorios diarios |
| `node /app/scripts/local-cron.mjs --renew-once` | `0 0,12 * * *` | Renovar Outlook |

La renovación llama a `127.0.0.1:3005` desde la propia app y termina con error si
falla. Cada comando hace una corrida y sale; no programes el loop `local-cron.mjs`
sin argumento. Conserva las tareas deshabilitadas durante el ensayo. Tras detener
el cron del origen, habilítalas y comprueba ejecución, historial y ausencia de
solapamientos. Una tarea puede interrumpirse al reemplazar su contenedor; revisa
su resultado y reintenta de forma controlada. No dejes dos schedulers activos.

## Túnel independiente

Crea el recurso de plantilla Cloudflare Tunnel separado, con `network_mode: host` y
el token actual como secreto `CLOUDFLARE_TUNNEL_TOKEN` de Coolify, nunca en Git. El origen ya no es
el alias Compose `app`: configura el ingress de `lucaplan.cl` hacia el proxy de
Coolify en `http://localhost:80`, que enruta ese Host a la aplicación nativa. Conserva
Host y HTTPS público en Cloudflare; desactiva la redirección HTTP→HTTPS de Coolify
para este origen HTTP y evita bucles. Comprueba acceso desde la red del túnel antes
del corte. No uses IPs efímeras ni actives este conector mientras el original sirva
la otra base. Los dominios los gestiona la Application, no un alias de contenedor.

## Backups nativos y gate de despliegue

En PostgreSQL configura un backup periódico con retención y copia fuera del host,
y **otro schedule dedicado a CI**: `enabled=false`, solo base `lucaplan`, sin
`dump_all`. No ejecutes este último manualmente mientras CI lo esté usando.
Prueba restauración; un estado exitoso no demuestra por sí solo que la copia se
pueda recuperar. Supervisa espacio y alertas; PostgreSQL no debe depender del disco
local como única copia. El estado `success` confirma backup local; si configuraste
S3, verifica también su réplica y alertas de subida.

Variables y secreto del repositorio GitHub:

| Nombre | Tipo | Contenido |
| --- | --- | --- |
| `COOLIFY_URL` | Variable | Origen HTTPS de la API, sin `/api/v1` |
| `COOLIFY_APP_UUID` | Variable | UUID de la Application Dockerfile |
| `COOLIFY_DATABASE_UUID` | Variable | UUID de PostgreSQL nativo conectado a la app |
| `COOLIFY_BACKUP_UUID` | Variable | UUID del schedule manual exclusivo de CI |
| `COOLIFY_TOKEN` | Secret | Permisos de leer, actualizar, respaldar y desplegar esos recursos |

El panel permanece privado por Tailscale en 8443. La API tiene un origen HTTPS
dedicado por Cloudflare limitado a las rutas `/api/v1` requeridas y autenticado con
Bearer; no publica el panel. Una página Cloudflare Access no sirve como respuesta.
No expongas el daemon Docker ni guardes tokens en URLs. Mantén consistente
la pareja `DATABASE_URL`/`COOLIFY_DATABASE_UUID`: CI no lee secretos de app para
inferir qué base estás usando.

PRs validan sin desplegar. Solo después de validar un **push a master** se ejecuta
el deploy; cerrar sin merge no despliega. Un push directo autorizado también dispara
el flujo: protege master si exiges PR. Las solicitudes se serializan y se omiten
commits que ya no sean la punta. El script:

1. Fija `git_commit_sha` por API, apaga auto-deploy/previews y verifica SHA, rama y
   build pack `dockerfile`.
2. Lee los UUID de ejecuciones previas del backup y aborta si alguna sigue activa.
   Solicita `PATCH /databases/{db}/backups/{schedule}` con `backup_now=true`.
3. Espera una ejecución nueva `success`, con archivo y tamaño positivo. Fallo,
   ausencia, timeout o varias ejecuciones nuevas bloquean el despliegue.
4. Solicita deploy del SHA fijado y espera `finished`, comprobando el commit.

Coolify 4.5.3 no devuelve UUID de ejecución al disparar el backup: la correlación
usa la diferencia de UUID del schedule dedicado. Una ejecución manual concurrente
puede ser indistinguible antes de aparecer la de CI; restringe ese acceso. La copia
es consistente al momento del dump, pero no incluye escrituras posteriores durante
el build. No es un mecanismo de rollback automático. Tras timeout o desconexión
puede seguir trabajando Coolify; consulta el panel antes de reintentar. Deploys
manuales evaden el gate y requieren backup y SHA validado comprobados por el operador.

## Ensayo, corte y recuperación

1. Conserva runtime, imágenes, secretos y volúmenes Desktop en
   `C:/Users/welli/selfhost/lucaplan`. No imprimas el Compose exportado: puede incluir
   secretos. Restaura un dump de ensayo en PostgreSQL nativo y verifica tablas,
   conteos y Prisma. Arranca app sin tareas activas ni túnel duplicado.
2. Comprueba `/login` y persistencia mediante acceso local controlado. No envíes
   correos ni sincronices Outlook desde la copia de ensayo. Verifica un backup nativo
   y su restauración en destino aislado antes del corte.
3. Detén tunnel, cron y app del origen y sus automatismos. Con escritores congelados,
   toma el dump final y restaura en el destino limpio; no sobrescribas datos nuevos.
   Comprueba conteos y secretos. Conserva PostgreSQL origen detenido tras restaurar.
4. Despliega el SHA de master validado, comprueba salud y activa el único túnel y
   Scheduled Tasks destino. Verifica login, cuentas, movimientos, callback/webhook
   Outlook, MCP y ejecución de cada tarea. Habilita las variables GitHub para merges
   siguientes; comprueba SHA, backup nuevo y resultado del primer flujo completo.

Si falla el backup, CI no solicita deploy y la app existente sigue atendiendo.
Si falla build, arranque o migración, inspecciona salud y logs antes de reintentar.
Volver al SHA anterior solo es válido con esquema compatible; no revierte datos.
Para volver al host origen, detén primero tareas, app y túnel destino. Si hubo
escrituras nuevas, expórtalas y prueba su recuperación antes de servir la copia vieja.
No restaures automáticamente un dump antiguo, borres volúmenes, uses `down -v`,
`prisma migrate reset` ni seeds. Solo un túnel y un scheduler deben quedar activos.

Docker/Coolify usan systemd en Ubuntu. Windows debe iniciar WSL mediante una tarea
probada; `restart: unless-stopped` no enciende WSL ni el equipo. Comprueba reinicio
completo, salud, tareas y dominio. El host apagado o sin red deja el sitio inaccesible.

Referencias oficiales: [Dockerfile](https://coolify.io/docs/applications/build-packs/dockerfile),
[Scheduled Tasks](https://coolify.io/docs/applications/operations/scheduled-tasks),
[backup API](https://coolify.io/docs/api/endpoints/databases/update-database-backup),
[ejecuciones](https://coolify.io/docs/api/endpoints/databases/list-backup-executions),
[cola 4.5.3](https://github.com/coollabsio/coolify/blob/v4.5.3/bootstrap/helpers/applications.php).
