# Luca Plan en Coolify sobre Ubuntu WSL2

Configuración para Coolify **4.5.3**, con Docker Engine dentro de Ubuntu 24.04 WSL2, separado
de Docker Desktop. `compose.coolify.yml` es una **Application Git / Docker Compose**, no un
Service pegado en el editor: construye este repositorio en un commit concreto.
El origen de Docker Desktop se conserva detenido tras el corte; no se eliminan sus datos.

## Configurar el recurso

1. Crea una Application del repositorio privado `WDCPrado/lucaplan-app`, rama `master`,
   Base Directory `/`, Compose Location `/compose.coolify.yml`. Usa GitHub App o deploy key de
   solo lectura. No habilites previews. **Auto Deploy debe estar desactivado** desde el principio.
2. En el host Linux crea el volumen externo `lucaplan-production-pgdata` y el directorio
   `/data/lucaplan/backups` con acceso restringido. El volumen tiene el mismo nombre que el de
   Desktop, pero pertenece a otro daemon: no comparte sus datos. Conserva copias fuera del host.
3. Copia el token existente de Cloudflare a `/data/lucaplan/tunnel-token`, fuera de Git, con
   permisos de lectura para el usuario del contenedor cloudflared y sin escritura para él.
   No imprimas el token. El archivo debe existir; Compose no crea un directorio en su lugar.
4. Conserva `lucaplan.cl` apuntando al túnel actual, cuyo destino sigue siendo `http://app:3005`.
   No asignes un dominio de proxy Coolify a este recurso ni publiques puertos de PostgreSQL.
   App, cron, postgres y tunnel comparten solo la red del recurso. No cambies Pomodoro.
5. Carga en **Environment Variables** los valores actuales declarados en el Compose. Conserva
   en especial `BETTER_AUTH_SECRET`, `BANCOCHILE_ENC_KEY`, Outlook, Resend y VAPID. La contraseña
   de PostgreSQL debe ser hexadecimal, apta para la URL de conexión. No copies `RAILWAY_*`,
   `SEED_PR_*` ni variables demo. `NEXT_PUBLIC_LANDING_ONLY=true` va a build y runtime; los demás
   secretos, solo a runtime. Deja los argumentos de build gestionados por el Dockerfile.
6. Habilita **Source commit availability → Available during build**. `SOURCE_COMMIT` lo aporta
   Coolify; no lo fijes manualmente: nombra la imagen `lucaplan-coolify:<SHA>` compartida por app
   y cron. Conserva las imágenes anteriores para rollback y vigila espacio de disco.
7. Configura **Pre-deployment command container** como `postgres` y este comando:

   ```sh
   sh -ec 'umask 077; dump="/backups/$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"; pg_dump -U lucaplan -d lucaplan -Fc -f "$dump"; pg_restore --list "$dump" >/dev/null'
   ```

   El hook usa el contenedor anterior y falla si no puede crear o leer el backup; Coolify
   aborta antes de reemplazarlo. `pg_dump` produce una instantánea consistente aunque la app
   anterior siga atendiendo durante el build. Verificar el catálogo no sustituye una prueba
   de restauración. En el primer deploy, sin contenedores anteriores, Coolify omite el hook:
   el backup y la restauración del origen son requisito previo.
8. Usa como **Custom Start Command**, sustituyendo el UUID real del recurso:

   ```sh
   docker compose --project-name UUID_DEL_RECURSO up -d --wait --wait-timeout 180
   ```

   Coolify inyecta las rutas de Compose y `.env`. No encadenes varios `docker compose` en ese
   campo: solo el primero recibe esas rutas. El comando hace fallar el despliegue si app/DB
   no quedan saludables. Cron y tunnel solo comprueban que su proceso esté corriendo.

El despliegue Compose de 4.5.3 construye primero y detiene los contenedores anteriores antes
de arrancar los nuevos. Hay una interrupción breve, no un rolling deploy. PostgreSQL conserva
su volumen; el cron anterior se detiene antes de las migraciones. El Dockerfile aplica
`prisma migrate deploy`; app espera a PostgreSQL y cron/tunnel esperan a app saludable.

## GitHub: validar antes de desplegar

Configura estas variables y secreto del repositorio:

| Nombre | Tipo | Valor |
| --- | --- | --- |
| `COOLIFY_URL` | Variable | Origen HTTPS accesible desde GitHub, sin `/api/v1` |
| `COOLIFY_APP_UUID` | Variable | UUID de la Application |
| `COOLIFY_TOKEN` | Secret | Token API con permisos para leer, actualizar y desplegar esa aplicación |

Expón el control de Coolify por una ruta HTTPS protegida, no el daemon Docker. El endpoint debe
aceptar el Bearer API desde el runner de GitHub; una pantalla de login de Cloudflare Access no
sirve como respuesta de API. No guardes credenciales en URLs, variables públicas ni Git.

`Validate PR` ejecuta typecheck/tests en los PR. Solo un **push a master validado** ejecuta el
job `deploy`, ahora en `ubuntu-latest`. Abrir/actualizar/cerrar un PR sin merge no despliega.
Un push directo autorizado a master también despliega; protege la rama si se exige PR.

El job omite commits que ya no sean la punta de master y serializa las solicitudes con
`concurrency`. `scripts/deploy-coolify.mjs` hace lo siguiente:

1. `PATCH /api/v1/applications/{uuid}` fija `git_commit_sha` al SHA validado y desactiva
   auto-deploy y previews. Lee de vuelta SHA, rama y build pack antes de continuar.
2. `POST /api/v1/deploy` solicita el despliegue. Coolify copia el SHA en la cola, por lo que
   un merge posterior no cambia el código que se construirá.
3. Consulta `GET /api/v1/deployments/{uuid}` hasta `finished`, verificando el commit. Fallos,
   cancelaciones, respuestas inválidas y timeout hacen fallar CI; no se imprime el cuerpo de
   las respuestas, que podría contener configuración sensible.

Mantén Auto Deploy apagado y no cambies el pin a `HEAD` manualmente. Cambios de configuración
o deploys manuales en el panel quedan fuera de la validación de GitHub: restringe ese acceso.
Si CI vence o pierde conexión, el trabajo remoto puede seguir activo; comprueba Coolify antes
de reintentar. Un CI fallido no restaura datos ni cancela una migración en marcha.

## Ensayo y corte desde Docker Desktop

No arranques dos cron ni dos conectores del mismo túnel apuntando a bases diferentes.

1. Conserva el Compose externo, secretos, imágenes y estado del origen en
   `C:/Users/welli/selfhost/lucaplan`. No publiques esos archivos ni uses `docker compose config`
   sin filtrar: puede mostrar contraseñas.
2. Restaura un dump de ensayo en PostgreSQL 18 del nuevo daemon, con `pg_restore --no-owner
   --no-acl`, y comprueba tablas, conteos y Prisma. En el ensayo arranca **solo postgres y app**
   con un Custom Start Command temporal terminado en `up -d --wait --wait-timeout 180 postgres app`.
   No habilites API de GitHub ni despliegue automático todavía. No pruebes acciones que envíen
   correo o sincronicen Outlook contra esa copia de datos.
3. Para el corte, deshabilita el runner y las tareas antiguas de despliegue/sincronización.
   Detén **tunnel, cron y app del origen** para impedir nuevas escrituras. Deja PostgreSQL
   disponible para el dump final y conserva toda la instalación para recuperación.
4. Haz un dump final, valida catálogo y restaura en el destino de migración limpio. Verifica
   restauración completa, conteos y secretos. Nunca restaures sobre una base con escrituras
   nuevas. Tras verificar, conserva PostgreSQL del origen detenido.
5. Fija en Coolify el SHA de master ya validado, restaura el Custom Start Command completo y
   despliega. Solo ahora arranca el túnel y cron destino. Comprueba login con código, cuentas,
   movimientos, callback/webhook Outlook, MCP y el siguiente tick del cron. El dominio no cambia.
6. Configura las variables/secreto de GitHub y verifica que el siguiente merge ejecute el flujo
   nuevo. Confirma el SHA en CI, Coolify y la etiqueta de imagen de app/cron.

Para abrir una prueba local usa temporalmente un puerto ligado a `127.0.0.1` en una copia
operativa de Compose. No publiques PostgreSQL ni añadas ese override a Git.

## Arranque del host y recuperación

Docker y los servicios Coolify arrancan con systemd dentro de Ubuntu. Windows debe iniciar esa
distribución WSL2 mediante su tarea de arranque configurada y probada; `restart: unless-stopped`
no enciende Windows ni WSL. Comprueba reinicio de Windows, disponibilidad de Docker, Coolify y
`https://lucaplan.cl`. El equipo apagado o sin red sigue dejando el sitio indisponible.

Ante un fallo de build/backup, revisa primero si los contenedores anteriores siguen saludables.
Si falla el arranque o una migración, conserva el dump y no pongas cron a trabajar sobre un esquema
incompleto. Comprueba logs y compatibilidad del esquema con la imagen anterior antes de recuperar.

Para volver a una versión compatible, fija su SHA validado en Coolify y despliega; mantén las
imágenes anteriores disponibles. El rollback de código **no revierte migraciones ni datos**.
Si hay que volver al host origen, detén primero app/cron/tunnel de Coolify. Si el destino recibió
escrituras, exporta y restaura esas escrituras en un destino de recuperación comprobado; no vuelvas
a servir la copia vieja silenciosamente. Solo un cron y un túnel deben estar activos al terminar.

No borres el volumen externo, no uses `down -v` y no restaures automáticamente el backup previo
encima de transacciones posteriores. Retención de backups e imágenes y copias fuera del equipo
son operación explícita; este flujo no las elimina.

Referencias oficiales: [Compose](https://coolify.io/docs/applications/build-packs/docker-compose),
[pin del commit por API](https://coolify.io/docs/api/endpoints/applications/update-application-by-uuid),
[deploy](https://coolify.io/docs/api/endpoints/deployments/deploy-by-tag-or-uuid) y
[cola de 4.5.3](https://github.com/coollabsio/coolify/blob/v4.5.3/bootstrap/helpers/applications.php).
