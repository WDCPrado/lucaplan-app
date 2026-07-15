## Why

La conexión local por scraping entrega saldos y cartolas, pero exige una sesión bancaria interactiva. Las notificaciones de correo de Banco de Chile permiten importar automáticamente los cobros y transferencias salientes que ya recibe `wellintoncosta.10@hotmail.com`, con costo API incremental prácticamente nulo y sin entregar credenciales bancarias.

## What Changes

- Agregar una alternativa de conexión de Banco de Chile mediante Outlook personal y Microsoft Graph, de solo lectura.
- Permitir un solo método activo por banco: `scraper` o `email`, nunca ambos. Para cambiar de método se deberá desconectar primero la conexión vigente; no habrá conciliación ni mezcla entre fuentes.
- Hacer una carga inicial desde el primer día del mes actual hasta el momento de conexión y luego sincronización incremental con delta, notificaciones webhook y recuperación periódica.
- Después de autorizar Outlook, detectar candidatos de cuentas/tarjetas por número o últimos 4. Una tarjeta de crédito se crea una sola vez aunque tenga cargos CLP y USD; ambas monedas definen sus buckets nacional e internacional.
- Mostrar los candidatos antes de crear datos financieros para que el usuario corrija, agregue instrumentos no detectados y valide el agrupamiento.
- Tras validar, pedir un snapshot con fecha: saldo propio de débito; sobregiro total/usado si aplica; y, por tarjeta de crédito, cupo/usado nacional CLP e internacional USD si aplica.
- Importar movimientos identificados por remitente y asunto exactos:
  - `Cargo en Cuenta`.
  - `Compra con Tarjeta de Crédito`.
  - `Transferencia a Terceros`.
  - `Transferencias de Fondos a <comercio>`.
- Actualizar desde ese snapshot saldos **estimados**: débitos/transferencias consumen caja o sobregiro; compras de tarjeta consumen el cupo CLP o USD correspondiente.
- Leer abonos recibidos y pagos de tarjeta/línea solo como movimientos internos de balance: no cuentan como ingreso, gasto ni presupuesto. Cartolas, intereses y ajustes desconocidos siguen excluidos y se corrigen con reconciliación manual.
- Crear los movimientos como confirmados, de solo lectura e idempotentes, usando el ID TEF cuando exista y, en su defecto, la identidad estable del mensaje.
- Solo después de la validación crear banco, cuentas, tarjetas y buckets; vincular cada movimiento del mes al instrumento/bucket correspondiente y enviar los movimientos no internos al flujo de categorización existente.
- Mostrar explícitamente que los saldos por correo son proyecciones desde el último snapshot manual, no saldos reportados por el banco, y permitir reemplazarlos mediante “Actualizar saldos”.
- Dejar Gmail fuera de la primera implementación. Su API también es económica, pero una aplicación pública que almacena correo con scopes restringidos agrega verificación y posible auditoría anual; se reevaluará solo si existe demanda real.

## Capabilities

### New Capabilities

- `bank-email-connection`: OAuth de Outlook, exclusividad del método por banco, filtrado de notificaciones Banco de Chile, carga inicial e incremental, idempotencia y límites funcionales de la fuente correo.

### Modified Capabilities

Ninguna. Esta capacidad se añade como alternativa explícita sin modificar el contrato del scraper local vigente.

## Impact

- Dominio y aplicación financiera: nueva conexión de correo, selección exclusiva del método e importación de eventos.
- Infraestructura: Microsoft Graph OAuth/delta/webhooks, persistencia cifrada del refresh token y estado de sincronización.
- Prisma: conexión de correo vinculada al usuario y al banco, método activo, fecha de reconciliación e identidad idempotente del mensaje; reutiliza `BalanceBucket` e `isInternal`.
- API/UI: conectar/desconectar Outlook, asistente de instrumentos/saldos iniciales, reconciliación manual, estado de sincronización y advertencias de cobertura.
- Operación: endpoint HTTPS público para Graph y renovación diaria de la suscripción; sin nuevas dependencias ni servicios pagados obligatorios.
- Interacción con `replace-fintoc-with-bancochile-scraper`: la implementación deberá partir del modelo Banco de Chile resultante de ese change activo y no intentar ejecutarse en paralelo sobre el mismo banco.
