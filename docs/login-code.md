# Acceso por código de correo

Luca Plan usa Better Auth `emailOTP`: seis dígitos, diez minutos, tres intentos y un solo uso.
El reenvío genera otro código e invalida el anterior. El formulario espera 60 segundos para
reenviar y el servidor limita las solicitudes aunque no se use la pantalla. Los códigos se
guardan hasheados en `verification`; no hay migración de esquema.

El registro público está cerrado también en el endpoint OTP. Un correo desconocido recibe
la misma respuesta de envío que una cuenta existente, pero no se envía ni crea una cuenta.
Las cuentas bloqueadas siguen sin poder entrar. Los endpoints de contraseña, alta pública,
recuperación y cambio de contraseña están deshabilitados; `/reset-password` lleva al login.
`NEXT_PUBLIC_LANDING_ONLY` solo controla el aviso open source; ponerlo en `false` no abre altas.

## Envío con Resend

Configura **`RESEND_API_KEY` solo en el servidor**. El adapter HTTP envía HTML y texto locales;
no hace falta publicar una plantilla en Resend ni instalar su SDK. El remitente por defecto
es `Luca Plan <no-reply@lucaplan.cl>`, con `RESEND_FROM` opcional para otras instalaciones.
Si la variable está vacía o solo contiene espacios, también se usa ese remitente predeterminado.
El dominio elegido debe estar verificado en la misma cuenta de Resend.

El envío corre fuera de la respuesta HTTP para no distinguir cuentas por latencia. Una
respuesta de envío correcta no garantiza entrega: si falla Resend, el servidor registra
`[login-code] No se pudo enviar el correo de acceso.` sin destinatario, código ni cuerpo del
proveedor. El formulario ofrece reenviar o cambiar el correo y muestra los errores de red,
los límites de intentos y los códigos inválidos/vencidos.

En el host local de producción estas variables deben estar en
`C:/Users/welli/selfhost/lucaplan/production.env`, usado por el manifiesto runtime
`C:/Users/welli/selfhost/lucaplan/compose.json`. Una clave en el `.env` del repositorio no
configura esos contenedores. Antes de actualizar la imagen, un operador debe comprobar la
presencia de `RESEND_API_KEY` en ese archivo **sin imprimir su valor**; si falta, no recrear
app/cron, porque los accesos nuevos necesitan correo. `RESEND_FROM` puede omitirse para usar
el remitente predeterminado. No copiar secretos a Git, argumentos de build ni al frontend.

## Cuentas existentes y OAuth

Se conservan los usuarios y sus datos financieros, sin renombrar IDs ni sembrar producción.
No se borra ninguna sesión al desplegar. Las sesiones verificadas conservan la duración de
30 días. Por protección de Better Auth, **el primer OTP de una cuenta cuyo correo aún no
estaba verificado elimina su contraseña y revoca sus sesiones previas** antes de crear la
sesión verificada. No se marca `emailVerified` masivamente para eludir esa comprobación.

El cliente mantiene `oauthProviderClient`, envía el query OAuth firmado y navega únicamente
al `url` devuelto por el servidor. Se conservan el consentimiento MCP, los hooks de grants,
la revocación y el contexto por solicitud. Cambiar parámetros firmados rechaza la solicitud.

Las altas administrativas siguen disponibles con `pnpm create:account --db-prod "..." --email
persona@example.com`; crean usuario y categorías sin contraseña. Los seeds crean cuentas
ficticias sin habilitar el endpoint público; ya no existe el ingreso con contraseña demo ni
el atajo `DEV_ANY_PASSWORD`. Nunca ejecutar seeds sobre producción.

## Pruebas aisladas

`pnpm test` prueba el plugin real con memory adapter y correo simulado: expiración, intentos,
reenvío, uso simultáneo, usuario desconocido/bloqueado, sesiones y continuación OAuth firmada.
El adapter Resend se prueba con transporte HTTP falso, sin destinatarios reales ni claves.

Para una preview local se usa una base desechable separada y `next dev -p 3154 -H 127.0.0.1`.
La cuenta `demo@lucaplan.cl` entra siempre con `000000` y no se le envía correo (`devLoginCode`)
en local (`NODE_ENV=development` exacto y sin `RAILWAY_ENVIRONMENT_NAME`) y en un entorno de PR de
Railway (`…pr-<n>`, que solo tiene datos sembrados); cualquier otra cuenta recibe su código
aleatorio por correo. Nunca en producción. Next no protege esto: `next start` solo pone
`production` si `NODE_ENV` viene vacío. Lo cierran el nombre exacto del entorno y que solo vale
para la cuenta demo; el `docker-compose.yml` con datos reales fija `NODE_ENV=production`.
Para probar el correo de verdad en local, un harness externo puede interceptar HTTP de Resend y
mostrarlo en un buzón local. La prueba
real de entrega de Resend requiere autorización del destinatario y configuración del operador;
los tests y el buzón simulado no afirman que el proveedor haya entregado un correo real.
