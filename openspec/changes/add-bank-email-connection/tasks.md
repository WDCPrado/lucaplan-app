## 1. Modelo y reglas de dominio

- [x] 1.1 Agregar la migración Prisma para `connectionMethod` y `EmailConnection`, con unicidad que impida dos métodos activos para el mismo usuario y banco.
- [x] 1.2 Modelar estados de conexión, candidatos no persistidos, mapeo confirmado, `lastBalanceReconciledAt` y errores de método activo/reautorización/ambigüedad.
- [x] 1.3 Implementar los casos de uso de conectar, desconectar y cambiar método, reutilizando la eliminación en cascada vigente y sin afectar bancos manuales.
- [x] 1.4 Implementar snapshot/reconciliación manual reutilizando `BalanceBucket` para caja, sobregiro y cupos nacional/internacional.

## 2. Parser e importación Banco de Chile

- [x] 2.1 Crear fixtures sanitizados para gastos CLP/USD, abonos/pagos internos y familias excluidas, sin PII proveniente del buzón real.
- [x] 2.2 Implementar y probar el parser fail-closed por remitente/asunto, con extracción de monto, moneda, fecha, comercio/destinatario, instrumento e ID TEF.
- [x] 2.3 Implementar detección del mes actual: agrupar CLP/USD del mismo último 4 en una tarjeta de crédito con dos buckets y separar débito/crédito.
- [x] 2.4 Implementar la confirmación atómica que crea instrumentos/buckets y luego vincula los movimientos del mes, preservando categorías y marcando abonos/pagos como `isInternal`.
- [x] 2.5 Reutilizar el categorizador existente después del vínculo; omitir internos y conservar sin categoría cuando falle.
- [x] 2.6 Implementar y probar la proyección posterior al snapshot: caja→sobregiro, abono→sobregiro/caja y crédito nacional/internacional por moneda.

## 3. Microsoft Graph

- [x] 3.1 Implementar OAuth Authorization Code + PKCE con estado verificable, `Mail.Read` y cifrado AES-256-GCM del refresh token con propósito separado.
- [x] 3.2 Implementar escaneo desde el primer día del mes actual, paginación/delta del Inbox y refresco manual usando `fetch` nativo y sin persistir cuerpos de correo.
- [x] 3.3 Implementar creación/renovación/eliminación de la suscripción, validación del webhook y recuperación delta ante notificaciones perdidas.
- [x] 3.4 Redactar la configuración requerida de Microsoft Entra, secretos, redirect URI, webhook HTTPS y renovación programada sin incluir valores sensibles.

## 4. API y experiencia de conexión

- [x] 4.1 Exponer rutas autenticadas para inicio/callback OAuth, estado, refresco y desconexión, y una ruta pública de webhook limitada a la validación de Microsoft.
- [x] 4.2 Agregar en la UI la elección exclusiva `Scraper`/`Outlook` y una revisión previa con tipo, últimos 4, monedas y conteos; permitir corregir/agregar instrumentos.
- [x] 4.3 Tras validar, solicitar caja actual, sobregiro total/usado opcional y cupo/usado nacional/internacional por tarjeta.
- [x] 4.4 Mostrar “Saldo estimado desde <fecha>”, buckets CLP/USD separados, estado OAuth, conteos omitidos y la acción “Actualizar saldos”.
- [x] 4.5 Mantener abonos/pagos internos fuera de categorías y presupuesto, sin ocultar que ajustaron la proyección.

## 5. Verificación

- [x] 5.1 Probar ventana del mes actual, cero persistencia antes de validar, agrupación de una tarjeta con dos cupos, mapeo ambiguo e idempotencia.
- [x] 5.2 Probar que el snapshot no se redescuenta, el vínculo apunta al bucket correcto y solo movimientos no internos se categorizan.
- [x] 5.3 Ejecutar tests, lint, typecheck y build aplicables; revisar que logs, errores y fixtures no contengan tokens ni PII.
- [ ] 5.4 Validar manualmente con Outlook detección/revisión, gastos CLP/USD, abonos/pagos internos, buckets y categorización.

## 6. Correcciones de validación y detalle real

- [x] 6.1 Agregar un fixture sanitizado de la plantilla real `Cargo en Cuenta` y extraer el comercio de `con cargo a Cuenta ... en <comercio> el ...`, sin persistir PII.
- [x] 6.2 Reutilizar el formateador monetario existente en el snapshot y cambiar sobregiro/cupos a total más disponible, derivando y validando el usado.
- [x] 6.3 Iniciar automáticamente el escaneo tras OAuth y rediseñar los candidatos como tarjetas editables coherentes con `AccountCard`, responsivas y accesibles.
- [x] 6.4 Probar descripción de comercio, derivación total/disponible y precisión USD con dos decimales y coma local.
- [x] 6.5 Ejecutar tests, lint, typecheck, build y validación visual móvil/escritorio del flujo completo (mock funcional en `app/design/email-snapshot`; el flujo real con Outlook queda en 5.4).
