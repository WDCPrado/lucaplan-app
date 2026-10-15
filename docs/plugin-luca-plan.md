# Plugin Luca Plan

El plugin expone las operaciones financieras de Luca Plan como herramientas MCP. Un host como
ChatGPT o Codex interpreta lo que pide la persona y llama al servidor; Luca Plan autentica,
autoriza y ejecuta cada operación sobre el usuario de la conexión.

La primera versión cubre el acceso por plugin. No agrega un chat dentro de Luca Plan, sesiones de
conversación, importación de cartolas ni una llamada nueva a IA. La detección de correos sigue
siendo determinística y corre por su flujo actual, aunque el plugin consulte o modifique los mismos
datos financieros.

## Paquete

El paquete portable vive en [`plugins/luca-plan`](../plugins/luca-plan):

- `plugin.json` identifica el plugin con el esquema Agent Plugins.
- `mcp.json` declara el transporte `streamable-http`, OAuth y los scopes requeridos.
- No incluye una API key ni secretos. El modelo lo aporta el host; el plugin no llama a OpenAI por
  su cuenta.

El `mcp.json` versionado apunta al servidor público `https://lucaplan.cl/api/mcp`.
El despliegue debe incluir estas rutas antes de registrar la conexión. La carpeta por sí sola no
instala una integración disponible mediante `@`: hace falta crear e instalar la conexión personal.

Para preparar una copia del manifiesto para el entorno local de pruebas, sin cambiar el paquete
de producción ni guardar secretos, genera otro archivo:

```bash
APP_ORIGIN=http://localhost:3117
jq --arg origin "$APP_ORIGIN" '
  .mcpServers["luca-plan"].url = ($origin + "/api/mcp")
  | .mcpServers["luca-plan"].extensions["com.openai"].auth.authorizationServerBase = ($origin + "/api/auth")
  | .mcpServers["luca-plan"].extensions["com.openai"].auth.resource = ($origin + "/api/mcp")
' plugins/luca-plan/mcp.json > /tmp/luca-plan-mcp.json
```

`APP_ORIGIN` debe ser exactamente el `BETTER_AUTH_URL` canónico del entorno, sin una barra
final (HTTPS en producción). El servidor deriva de ahí el emisor OAuth (`/api/auth`) y el recurso MCP (`/api/mcp`); no
acepta que el encabezado `Host` de una solicitud cambie esas identidades.

## Identidad y permisos

Desde Luca Plan se inicia sesión con correo y contraseña, pero la autoridad es el identificador
interno del usuario que entrega OAuth. Las herramientas no reciben `email`, `userId` ni `scopes`:
los esquemas rechazan esas claves y cada caso de uso comprueba que los recursos pedidos pertenecen
al usuario autenticado.

Los scopes son:

| Scope             | Uso                                                                |
| ----------------- | ------------------------------------------------------------------ |
| `openid`, `email` | Identificar la cuenta que aprueba la conexión.                     |
| `offline_access`  | Renovar el acceso sin pedir inicio de sesión en cada llamada.      |
| `finance:read`    | Consultar cuentas, categorías, movimientos, planes y resúmenes.    |
| `finance:write`   | Crear, corregir o eliminar datos dentro de las reglas del dominio. |

La autorización muestra el consentimiento en `/plugin/consent`. Cada usuario puede revisar sus
conexiones en `/plugin`; la API equivalente es `GET /api/plugin/connections`, y
`DELETE /api/plugin/connections/[id]` revoca una conexión propia. Los modelos OAuth, consentimientos,
revocaciones y operaciones se agregan con una migración independiente: no reescriben las tablas
financieras existentes.

## Operaciones disponibles

El contrato fuente está en [`lib/schemas/plugin.ts`](../lib/schemas/plugin.ts). Sus 39 herramientas
se agrupan así:

- **Operación e idempotencia:** consultar el resultado de una escritura por `operationId`.
- **Cuentas y saldos:** listar y crear cuentas manuales, actualizar el estado actual y reconciliar
  un banco conectado por correo desde un snapshot explícito.
- **Movimientos y categorías:** buscar, crear, corregir, eliminar y categorizar movimientos; crear,
  editar y eliminar categorías.
- **Presupuesto e ingresos:** consultar o fijar presupuestos mensuales, administrar fuentes de
  ingreso y registrar o deshacer su movimiento del mes.
- **Recurrentes:** listar y administrar plantillas, marcar el período y vincular el cobro bancario
  existente.
- **Cuotas:** listar y administrar planes, editar cuotas y vincular, desvincular o registrar sus
  pagos.

Esta versión no administra la configuración global de la aplicación. En cuentas permite crear y listar,
pero todavía no editar ni eliminar. Tampoco convierte una cartola en movimientos ni categoriza con
IA: un host puede leer un documento y proponer argumentos, pero Luca Plan solo ejecuta las
operaciones explícitas que pasen la validación del servidor.

## Reglas de escritura

- Todas las escrituras llevan un `operationId` elegido por el cliente. Si queda `pending` o
  `uncertain`, se consulta con `lucaplan_ver_operacion` y se revisan los datos afectados; no se
  reintenta con otro identificador automáticamente.
- CLP y USD se mantienen separados. Los campos nacionales, caja y sobregiro son CLP; el cupo
  internacional es USD.
- `lucaplan_actualizar_saldos` representa el estado actual. No sirve para una cartola histórica y
  no cambia cupos totales.
- `lucaplan_reconciliar_saldos_correo` recibe la fecha real del documento, rechaza fechas futuras o
  anteriores al snapshot vigente y se detiene si no puede reproyectar con seguridad movimientos
  ya importados. Cambia saldos; no crea movimientos desde la cartola.
- Las eliminaciones y vínculos respetan las reglas existentes: por ejemplo, no duplican cobros del
  banco ni convierten desvincular una cuota en borrar el movimiento.

## Conectar ChatGPT o Codex

Para usarlo desde ChatGPT web o móvil hace falta desplegar `/api/mcp` en HTTPS y registrar esa URL
con **Add custom MCP server** en una cuenta o workspace donde la función esté habilitada. El
registro no se completa instalando esta carpeta: la persona debe iniciar sesión en Luca Plan,
elegir la cuenta y aceptar los scopes. Las políticas de la cuenta o del workspace pueden impedir
agregar servidores personalizados.

Con el servidor desplegado:

1. Verifica que `BETTER_AUTH_URL` sea el origen HTTPS público correcto.
2. En ChatGPT Plugins, pulsa **+ → Add custom MCP server**. Usa nombre **Luca Plan**, URL
   `https://lucaplan.cl/api/mcp` y autenticación **OAuth** con registro dinámico del cliente.
3. Crea el plugin personal, inicia sesión con el usuario de Luca Plan y acepta sus permisos.
4. Instala el plugin creado, abre un chat nuevo y selecciónalo con `@`.
5. Comprueba primero una consulta. Una escritura reversible requiere una instrucción explícita
   del usuario y un `operationId` nuevo; no cambies datos reales solo para probar la conexión.
6. Revisa o revoca la conexión desde `https://lucaplan.cl/plugin` en Luca Plan.

Si se necesita conectar el paquete local con ese plugin personal, conserva su identificador
`plugin_asdk_app...` generado por ChatGPT para registrar el vínculo OpenAI. No se inventa ni se
obtiene de `client_id` OAuth. La creación e instalación del plugin y el consentimiento se hacen
con la cuenta de la persona; este repositorio no guarda sus credenciales.

El entorno local de WDC-117 usa la app en `http://localhost:3117` y una base aislada en el puerto
`5117`. Los datos son demo; no se conecta a producción. El usuario base es `demo@lucaplan.cl` con
contraseña `lucaplan1234`, además de los usuarios sembrados por escenas.

La escena `wdc-117@lucaplan.cl`, con la misma contraseña, incluye una conexión de demostración
sin tokens para revisar sus permisos y revocarla desde Ajustes → Gestionar conexiones.

La estructura portable y el flujo para registrar un MCP personalizado están documentados en
[Package your plugin](https://developers.openai.com/plugins/build/plugins) y
[Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt).
