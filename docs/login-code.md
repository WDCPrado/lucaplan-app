# Acceso por código de correo

Luca Plan usa Better Auth `emailOTP`: seis dígitos, diez minutos, tres intentos y un solo uso.
El reenvío genera otro código e invalida el anterior. El formulario espera 60 segundos para
reenviar y el servidor limita las solicitudes aunque no se use la pantalla. Los códigos se
guardan hasheados en `verification`; no hay migración de esquema.

El registro lo controla `SIGNUP_OPEN` (desde WDC-181): con `SIGNUP_OPEN=true` exacto, o siempre
en `NODE_ENV=development`, un correo nuevo recibe su código y la cuenta se crea al verificarlo,
con el set de categorías precreado. Cerrado (cualquier otro valor), un correo desconocido recibe
la misma respuesta de envío que una cuenta existente, pero no se envía ni crea una cuenta. El
código fijo `000000` sigue siendo solo de la cuenta demo en local y en los entornos de PR.
Las cuentas bloqueadas siguen sin poder entrar. Los endpoints de contraseña, alta pública,
recuperación y cambio de contraseña están deshabilitados; `/reset-password` lleva al login.
`NEXT_PUBLIC_LANDING_ONLY` solo controla el aviso open source; ponerlo en `false` no abre altas.

## Envío con Resend

Configura **`RESEND_API_KEY` solo en el servidor**. El adapter HTTP envía HTML y texto locales;
no hace falta publicar una plantilla en Resend ni instalar su SDK. El remitente por defecto
es `Luca Plan <no-reply@lucaplan.cl>`, con `RESEND_FROM` opcional para otras instalaciones.
Si la variable está vacía o solo contiene espacios, también se usa ese remitente predeterminado.
El dominio elegido debe estar verificado en la misma cuenta de Resend.

En local (`NODE_ENV=development`, fuera de Railway) sin `RESEND_API_KEY` el código no se envía: se
imprime en la consola del servidor con el correo. En producción sin Resend nunca se imprime y el
envío falla.

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

## Biometría

Con sesión, Ajustes agrega una passkey del aparato (huella o cara) y desde el login se entra con
ella sin escribir el correo. Son las rutas de `@better-auth/passkey`, sin rutas propias
(`arch/v1/infrastructure/auth/passkey.ts`): `GET /api/auth/passkey/generate-register-options` y
`POST …/verify-registration` (`{ response, name? }`, exigen sesión), `GET …/generate-authenticate-options`
y `POST …/verify-authentication` (sin sesión), `GET …/list-user-passkeys` y `POST …/delete-passkey`
(`{ id }`, solo las propias). Renombrar (`update-passkey`) está apagado. Sin límite de aparatos y se
puede quitar la última: el código por correo sigue. El nombre (`<aparato> · <navegador>`) tiene
máximo 60 caracteres; el del selector del aparato es siempre el correo.

Entrar solo sirve con una passkey guardada, así que nunca crea cuentas (tampoco con la base vacía
de `/setup`), y una cuenta bloqueada responde 403 `BANNED_USER` como con el código. Registrar
exige una sesión de menos de un día (`freshAge` por defecto de Better Auth): si no, 403
`SESSION_NOT_FRESH` y hay que volver a entrar. Se exige que el aparato verifique a la persona
(huella, cara o PIN): sin eso no se guarda la passkey (400) ni se entra (401), con el código
`PASSKEY_USER_NOT_VERIFIED`.

En pantalla (`app/login/passkey-sign-in.tsx`, `components/finance/passkeys-section.tsx`; textos en
`lib/passkey.ts`) se dice siempre «biometría». En el login, bajo «Enviar código», una línea «o» y
«Entrar con biometría» (borde, huella, 44 px); el correo lleva `autocomplete="username webauthn"`
y, si el navegador lo soporta, el teclado ofrece la passkey. Sin WebAuthn el botón no aparece;
cancelar el diálogo del sistema no muestra nada. Al entrar sigue el mismo destino que el código
(incluido el `url` de OAuth). En Ajustes, la tarjeta «Biometría»: «Agregar este aparato» en la
acción (deshabilitada sin WebAuthn, con la razón al pie), los aparatos con su fecha de alta y
«Quitar» con confirmación.

Una passkey vale solo en el dominio donde se registró. El dominio y el origen aceptado son los de
`BETTER_AUTH_URL` (`http://localhost:<puerto>` en local, que el navegador acepta sin HTTPS); en un
entorno de PR de Railway, los de `https://$RAILWAY_PUBLIC_DOMAIN`, porque detrás del proxy la
dirección del pedido es la interna. Sin ninguna de las dos, los del pedido. Cada entorno (local,
cada PR, producción) tiene las suyas.

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
