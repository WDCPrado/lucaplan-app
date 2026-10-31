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
   interno del proxy, no un puerto público). Usa la deploy key de solo lectura existente.
   Mantén previews desactivadas y Auto Deploy apagado durante el ensayo.
4. Desactiva el healthcheck HTTP generado de Coolify (`health_check_enabled=false`):
   el Dockerfile ya define un HEALTHCHECK Node contra `/login` en `3005`, sin curl/wget.
   Coolify 4.5.3 detecta ese check y espera la salud del contenedor. Mantén desactivado
   **Consistent Container Name** para conservar el reemplazo y su espera de salud.
   Conserva el CMD del Dockerfile: aplica migraciones pendientes
   y arranca Next. No añadas variables `RAILWAY_*`, `SEED_PR_*` ni datos demo.
5. Copia los secretos actuales: `BETTER_AUTH_SECRET`, `BANCOCHILE_ENC_KEY`, Resend,
   Outlook y VAPID. Conserva `BETTER_AUTH_URL=https://lucaplan.cl`, callback y webhook
   públicos actuales. `NEXT_PUBLIC_LANDING_ONLY=true` va a build y runtime; los demás
   secretos solo a runtime. No imprimas URLs de base ni respuestas API completas.
6. Configura `git_commit_sha=HEAD` para seguir los pushes de `master`. Coolify construye
   y etiqueta la imagen nativa; registra el SHA efectivo y conserva imágenes anteriores.

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

## Auto-deploy nativo al mergear

La app usa el repositorio privado con deploy key de solo lectura y un **Manual Git
Webhook** nativo de Coolify. No necesita GitHub App ni token API en Actions.

1. Selecciona `master`, `git_commit_sha=HEAD` y Auto deploy: **Deploy on push (webhooks)**.
   Mantén Preview Deployments desactivado.
2. En Webhooks → Manual Git Webhooks → GitHub genera y guarda un secreto largo
   aleatorio. El endpoint público es
   `https://coolify-api.lucaplan.cl/webhooks/source/github/events/manual`.
   Cloudflare publica solo esa ruta; panel y API administrativa permanecen privados
   por Tailscale en 8443. No expongas Docker ni guardes el secreto en Git.
3. En GitHub Settings → Webhooks agrega esa URL, `application/json`, el mismo
   secreto, SSL verification habilitada y **Just the push event**. Coolify verifica
   la firma de GitHub. No selecciones eventos de PR ni habilites previews.
4. Exige el check `validate` en la protección de `master` antes del merge. Actions
   valida PRs y pushes, pero no despliega. El webhook despliega el push integrado:
   no espera al check posterior al merge. Un push directo también despliega;
   restringe bypasses si todos los cambios deben pasar por PR.
5. Tras mergear comprueba Recent Deliveries, Deployment Logs, SHA, salud y dominio.
   No basta `finished`: verifica `running:healthy` y `/login`. Cerrar un PR sin
   merge no genera push a master. `/login` no comprueba todas las integraciones.

Durante el ensayo deja Auto Deploy o el webhook inactivo. Si falla una entrega,
revisa firma, endpoint, evento y rama antes de reenviarla. Si ya hay un deploy activo,
consulta su estado antes de iniciar otro. Actions no necesita variables ni secretos
`COOLIFY_*` para este flujo.

## Backups nativos

Configura backups periódicos de PostgreSQL en Coolify, con retención, alertas y
copia fuera del host. Prueba restauración y supervisa espacio. `success` confirma
la copia local; con S3 verifica también su réplica y alertas de subida.

No hay backup obligatorio antes de cada deploy. Antes del corte o de migraciones
destructivas, desactiva temporalmente Auto Deploy, congela escritores, ejecuta y
verifica un backup manual y acuerda recuperación. Solo entonces actualiza. El dump
no incluye escrituras posteriores ni vuelve reversible una migración. Reactiva
el webhook/Auto Deploy cuando el resultado esté verificado.

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
   Outlook, MCP y ejecución de cada tarea. Habilita Auto Deploy y el webhook para
   merges siguientes; comprueba entrega firmada, SHA y salud del primer deploy nativo.

Si falla un backup previo al corte o a una migración destructiva, no continúes y
mantén Auto Deploy desactivado hasta resolverlo.
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
[webhooks Git manuales](https://coolify.io/docs/applications/deployments/manual-webhooks) y
[backups nativos](https://coolify.io/docs/databases/backups).
