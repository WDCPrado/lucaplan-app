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

El contrato fuente está en [`lib/schemas/plugin.ts`](../lib/schemas/plugin.ts): cada herramienta
tiene `title`, una descripción que empieza por cuándo usarla (y cuál usar en su lugar) y cada
argumento con `.describe()`. Hoy son 51, agrupadas así:

| Grupo | Leer | Escribir |
| --- | --- | --- |
| Operaciones | `ver_operacion` | — |
| Cuentas y saldos | `listar_cuentas`, `previsualizar_eliminar_cuenta` | `crear_cuenta`, `editar_cuenta`, `eliminar_cuenta`, `actualizar_saldos`, `reconciliar_saldos_correo` |
| Categorías | `listar_categorias` | `crear_categoria`, `editar_categoria`, `eliminar_categoria`, `asignar_categoria`, `aprender_categoria` |
| Movimientos | `buscar_movimientos`, `ver_movimiento` | `crear_movimiento`, `corregir_movimiento`, `eliminar_movimiento` |
| Presupuesto | `resumen_mes`, `ver_presupuesto` | `fijar_presupuesto_global`, `fijar_presupuesto_categoria` |
| Ingresos | `listar_ingresos` | `crear_ingreso`, `editar_ingreso`, `eliminar_ingreso` (finaliza desde un mes), `registrar_ingreso_mes`, `deshacer_ingreso_mes` |
| Recurrentes | `listar_recurrentes`, `candidatos_pago_recurrente` | `crear_recurrente` (desde un movimiento), `planificar_recurrente` (sin cobro previo), `editar_recurrente`, `activar_recurrente`, `eliminar_recurrente`, `marcar_pago_recurrente`, `vincular_pago_recurrente` |
| Cuotas | `listar_planes_cuotas`, `ver_plan_cuotas`, `candidatos_pago_cuota` | `crear_plan_cuotas`, `editar_cuota`, `categorizar_plan_cuotas`, `eliminar_plan_cuotas`, `pagar_cuota`, `vincular_pago_cuota`, `desvincular_pago_cuota`, `mover_pago_cuota` |
| Planificación | `planificar_periodo` | — |
| Configuración | `ver_configuracion` | — |

Todas llevan el prefijo `lucaplan_`. Cómo se navega: **buscar o listar → ver detalle → actuar**.

- `buscar_movimientos` filtra por texto, cuenta, moneda, categoría, sin categoría, banco, fechas,
  montos, dirección, internos y estado, con orden estable (fecha desc, id desc) y paginación
  explícita (`total`, `offset`, `limit`, `hasMore`, `nextOffset`). Cada movimiento trae su
  procedencia (`source`: manual, banco por correo, ingreso, recurrente, cuota), sus relaciones y
  sus capacidades efectivas (`canEdit`, `editableFields`, `canDelete` y el motivo si no), calculadas
  con las mismas reglas que el caso de uso.
- `planificar_periodo` es solo lectura: posición de hoy por moneda (caja, sobregiro usado y
  disponible, deuda y cupo de tarjetas, desde los buckets en cuentas conectadas), ingresos
  esperados vs registrados, recurrentes esperadas vs pagadas, cuotas que vencen, movimientos
  confirmados con fecha futura y el presupuesto como tope. Lo ya pagado por un movimiento no se
  cuenta dos veces y el presupuesto no se suma como gasto.
- Eliminar una cuenta manual va en dos pasos. `previsualizar_eliminar_cuenta` calcula el impacto
  (incluidas las relaciones cruzadas en ambos sentidos) y entrega un `confirmationToken` firmado con
  `BETTER_AUTH_SECRET` sobre el hash del estado, válido 15 minutos. `eliminar_cuenta` lo exige,
  vuelve a leer el estado dentro de una transacción serializable y no borra nada si cambió. Nunca
  borra bancos ni cuentas conectadas; el banco manual se borra si queda vacío.
- `planificar_recurrente` crea un compromiso sin cobro real previo: sin movimientos y sin texto
  bancario inventado, así que no reclama cargos por texto. El primer cargo del banco vinculado con
  `vincular_pago_recurrente` le fija su texto para reconocer los siguientes.
- `ver_configuracion` muestra la misma fuente que usan la app, los cálculos y las notificaciones
  (modo del período, cierres, ritmo, alertas, días de aviso). Es **solo lectura** desde el chat: hoy
  esa configuración es común a toda la instalación (`app_setting`, `budget_alert`) y cambiarla desde
  un usuario la cambiaría para todos. Escribirla por chat requiere antes hacerla por usuario.

## Respuestas y errores

- `content` lleva un resumen corto legible y `structuredContent` los datos, siempre como
  `{ result }` (es lo que declara el `outputSchema` genérico de cada herramienta).
- `annotations` explícitas: `readOnlyHint`, `destructiveHint` (solo borrar, sobrescribir o deshacer),
  `idempotentHint: true` (toda escritura pasa por `operationId`) y `openWorldHint: false`.
- Los errores vuelven como resultado con `isError: true` y un texto accionable: qué campo falló y
  por qué (argumentos), "no existe o no es tuyo" (propiedad) o el motivo de la regla de negocio.
- Sin token, la respuesta HTTP es 401 con `WWW-Authenticate` (`resource_metadata`, `scope`, `error`,
  `error_description`). Sin el scope, la herramienta responde con
  `_meta["mcp/www_authenticate"]` y `error="insufficient_scope"`.

## Reglas de escritura

- Todas las escrituras llevan un `operationId` elegido por el cliente. Las lecturas (incluidas la
  planificación y la previsualización) no lo consumen.
- **Rechazo vs incierto.** Si el caso de uso rechaza antes de escribir (propiedad, validación o regla
  de negocio), la respuesta empieza con "Rechazado sin cambios" y la reserva se libera: la misma
  `operationId` puede reusarse con datos corregidos. Si el error ocurre después de empezar a
  escribir, la operación queda `uncertain`: se consulta con `lucaplan_ver_operacion` y se revisan los
  datos; no se reintenta con otra clave.
- CLP y USD se mantienen separados; las conversiones a CLP del presupuesto son referenciales.
- Caja, sobregiro y cupo son distintos. En cuentas conectadas el sobregiro sale de sus buckets: el
  saldo de la cuenta nunca se pone negativo para representarlo.
- Planificar (fuentes de ingreso, recurrentes, planes de cuotas futuros, presupuestos) no crea
  movimientos, no registra pagos ni cambia la caja.
- Editar o borrar un movimiento pendiente no mueve la caja: solo un confirmado la movió.
- Se valida la propiedad de todos los ids de entrada, también los relacionados (`toPlanId`,
  `transactionId`, `sourceTransactionId`, `categoryId`, `accountId`, `incomeId`).
- `lucaplan_actualizar_saldos` representa el estado actual; `lucaplan_reconciliar_saldos_correo`
  recibe la fecha real del documento y rechaza fechas futuras o anteriores al snapshot vigente.
- Nada de conexiones bancarias, buzones, lectura de correos ni IA desde el plugin.

## Cambiar los metadatos de las herramientas

ChatGPT guarda la lista de herramientas al conectar. Después de cambiar nombres, descripciones,
esquemas o `instructions`: desplegar, y en ChatGPT abrir el plugin → **Refresh** (o reconectar) para
que tome la nueva lista. Sin eso sigue usando la anterior.

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



### Contexto financiero de búsqueda y detalle

`lucaplan_buscar_movimientos` y `lucaplan_ver_movimiento` comparten `financialContext`:

- `recordedAmount`: importe/moneda guardados, no necesariamente el cargo definitivo de la cartola.
- `recordedImpact`: destino deducido de cuenta/moneda y vínculo de bucket guardado (si existe). `bucketConflict` detecta discrepancias entre ambos. No confirma que la proyección de saldos haya sido ejecutada ni identifica el cupo definitivo del banco.
- `budget`: equivalente bruto en CLP con el mismo proveedor de cambio que la app. USD se marca `reference_only`; falla de cotización se informa como `unavailable` con importe null. No cambia moneda ni cupo, ni incorpora el neteo de reembolsos.
- `reconciliation`: evidencia del registro y campos desconocidos explícitos. Actualmente no se guardan por separado importe original, fecha contable ni verificación contra cartola; null no significa cero ni falso.

Un aviso bancario en pesos puede corresponder a un consumo internacional. Antes de crear o corregir, comparar cartola/no facturados, comercio, fechas corridas y vínculos. No duplicar por diferencia de moneda o fecha ni inferir tipo de cambio oficial desde una conversión aproximada.

`affectsCash` se limita a movimientos confirmados de cuenta corriente. `countsInBudget` indica elegibilidad como gasto confirmado no interno en categoría de gasto con tope positivo del `budgetPeriod` del movimiento (incluye carry-forward y ciclo de tarjeta). No representa ingreso, compromiso pendiente ni gasto neto después de reembolsos. Usar presupuesto/medidor para esos totales.

Las capacidades distinguen edición ordinaria y conciliación. `canReconcile` identifica cuentas compatibles; `canCorrectCurrency` está condicionado por vínculos y transferencias. La previsualización bancaria valida además reembolsos, categorías y buckets antes de autorizar el lote.

### Plan y liquidez en el medidor

`lucaplan_medidor_financiero` distingue `planStatus` (ingresos, gastos y compromisos del
período) de `status` (plan más liquidez). `balance`, `projectedBalance` y porcentajes
siguen siendo métricas del plan: no se les vuelve a descontar la deuda de la línea.
`liquidity` contiene caja CLP, línea utilizada y posición neta (caja menos línea), basada
en los últimos saldos registrados, incluso si se consulta un período pasado o futuro.
Una posición negativa implica `en_deficit`; cero o línea utilizada impiden `sano` y
suponen al menos `al_limite`. `projectedStatus` combina la proyección del plan con esa
misma liquidez registrada: no predice un saldo bancario futuro. No incluye cupos como
caja, ni resta toda la deuda de tarjeta a un plan que ya cuenta sus compras/cuotas.

Modo débito (`calendar`) organiza por mes; modo crédito (`card_cycle`) por ciclo.
Ambos incluyen corriente y tarjeta. Cambiar de modo nunca filtra cuentas ni altera saldos.
Los saldos desactualizados requieren conciliación: el medidor no verifica el banco.

### Conciliación que aplica cambios

`lucaplan_previsualizar_conciliacion` valida una cuenta completa y devuelve un
`previewToken`, diferencias antes/después y movimientos posteriores que reproyectará.
`lucaplan_aplicar_conciliacion` recibe el mismo contenido y ese token, además de su
`operationId`. También está disponible en `POST /api/accounts/:id/reconciliation`
para la app: sin token previsualiza, con token aplica. Comparte validaciones y servicio.

El documento manda en importe y moneda: las correcciones usan IDs explícitos y preservan
identidad, externalId, categoría elegida y vínculos. No reemplazan el movimiento con un alta.
Los cambios se guardan en una transacción serializable con auditoría y recibo idempotente.
La sincronización y la conciliación toman un bloqueo PostgreSQL común por usuario.
Un correo reprocesado no sobrescribe un movimiento conciliado. Un aviso tardío que pueda
corresponder a un alta conciliada se vincula solo si es inequívoco; si no, requiere revisión.

El corte es propio de los buckets de la cuenta, no la fecha de importación ni del último
refresh del buzón. Se exige medir todos sus buckets, se conserva un corte bancario más
reciente y se reproyectan únicamente movimientos confirmados posteriores. Los del día del
corte sin hora de recepción conocida deben declararse expresamente en
`includedSameDayIds`; los futuros del plan no son efectivo bancario ocurrido. La salida
identifica lo que se reproyectará. Un cambio concurrente invalida el token del dry run.

Los movimientos vinculados admiten corregir fecha y texto conservando sus enlaces;
para cambiar su importe/moneda/categoría hay que revisar primero el ingreso, recurrente o cuota.
Los reembolsos impiden bajar el gasto/abono por debajo de lo ya vinculado o cambiarlo de CLP.
Las altas se rechazan si existe un candidato cercano; no se crean transferencias internas
sin sus dos patas. Las categorías se eligen con evidencia del usuario, nunca por adivinación.

Las herramientas antiguas de previsualización simple y reconciliación de saldos se conservan
por compatibilidad. Para documentos históricos y correcciones usa el flujo nuevo, no
`actualizar_saldos` fingiendo que un saldo histórico es actual.

Búsqueda y detalle exponen `bankReconciliation` con evidencia cuando existe.
