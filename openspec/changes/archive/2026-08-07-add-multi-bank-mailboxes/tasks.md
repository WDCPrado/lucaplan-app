## 1. Registry de bancos

- [x] 1.1 Crear el catálogo `bankKey → { name, senders, parse }` con `bancochile` como única entrada real, junto a `bancochile-email-map.ts`
- [x] 1.2 Añadir el enrutado por remitente (mensaje → `bankKey` o `null`) y un guard que falle explícito ante una clave desconocida
- [x] 1.3 Inyectar el catálogo como dependencia de los use-cases (igual que el resto de ports), para que los tests puedan registrar un banco de prueba
- [x] 1.4 Test del registry: remitente conocido va a su banco, remitente ajeno no se parsea, un remitente no pertenece a dos bancos

## 2. Esquema y migración de datos

- [x] 2.1 Modelar `EmailMailbox` (autorización, token cifrado, `deltaLink`, suscripción, estado, correos descartados) y `EmailBankLink` (buzón, `bankProvider`, `bankId`, etiqueta, snapshot, omitidos, estado de setup) en `prisma/schema.prisma`
- [x] 2.2 Cambiar la unicidad de `bank_connection_method` a `(userId, bankProvider, mailboxId)` y añadir unicidad `(mailboxId, bankProvider)` en el vínculo (un banco no se repite dentro de un buzón)
- [x] 2.3 Escribir la migración transaccional: una fila de buzón y una de vínculo por cada `email_connection`; reescritura de `external_id` de las cuentas importadas al formato con banco; drop de `email_connection`
- [x] 2.4 Ensayar la migración contra un clon de producción (`pnpm clone:db`) y verificar que tras migrar el refresco manual sincroniza sin reautorizar y sin duplicar movimientos

## 3. Dominio

- [x] 3.1 Separar en `email-connection.domain.ts` los tipos de buzón y de vínculo, con sus ports (`EmailMailboxRepository`, `EmailBankLinkRepository`) y el `BankMailProvider` operando por buzón
- [x] 3.2 Ajustar los errores de negocio: mensajes sin banco hardcodeado y error nuevo para "etiqueta requerida" al repetir proveedor

## 4. Use-cases

- [x] 4.1 Eliminar la constante `BANK_PROVIDER`: escaneo, confirmación, reconciliación y desconexión reciben el vínculo; el alta OAuth y la sincronización reciben el buzón
- [x] 4.2 Reescribir la sincronización como una pasada por buzón que enruta cada mensaje al vínculo de su banco y aplica instrumentos, proyección y notificaciones por vínculo
- [x] 4.3 Contabilizar omitidos por vínculo (solo su banco) y descartados por buzón (correo que ningún banco reclama)
- [x] 4.4 Añadir el alta de un banco en un buzón ya autorizado, reutilizando su token, y la validación de etiqueta obligatoria a partir del segundo vínculo del mismo proveedor
- [x] 4.5 Desconexión en dos niveles: por vínculo (borra su banco y datos) y por buzón (borra todos y libera suscripción y token), con un resumen previo de lo que se eliminará (movimientos, recurrentes, cuotas e ingresos de esas cuentas)
- [x] 4.6 Componer el externalId de cuentas con el banco (`email:<bankKey>:acct:<ref>`, `email:<bankKey>:card:<last4>`)
- [x] 4.7 Rechazar el alta de un banco que ya tiene vínculo en ese mismo buzón, con error de negocio propio
- [x] 4.8 Mantener verde `email-connection.test.ts` con un buzón y un banco, y añadir tests con un banco de prueba en el catálogo: dos bancos en un buzón (una pasada, cada movimiento a su banco), correo del otro banco que no incrementa omitidos, mismo banco en dos buzones sin fusionarse, banco repetido en el mismo buzón rechazado

## 5. Infraestructura

- [x] 5.1 Repositorios Prisma de buzón y vínculo, incluida la búsqueda del buzón por `subscriptionId`
- [x] 5.2 Proveedor Graph por buzón: una suscripción y un delta por correo, con la renovación existente intacta
- [x] 5.3 Adaptar el `EmailSetupStore` para crear el banco con nombre compuesto (catálogo + etiqueta) y borrar solo lo del vínculo

## 6. HTTP

- [x] 6.1 Actualizar las diez rutas de `app/api/email-connection/*` (`connect`, `callback`, `candidates`, `confirm`, `reconcile`, `refresh`, `disconnect`, `status`, `webhook`, `renew`) para operar sobre buzón o vínculo según corresponda
- [x] 6.2 Migrar `renew` —la que llama el scheduler del despliegue cada 12 h— a buzones: hoy consulta y actualiza `prisma.emailConnection` directo, fuera del repositorio; ninguna ruta puede quedar apuntando a la tabla eliminada
- [x] 6.3 Añadir el alta de banco en un buzón existente y devolver en `status` la vista de dos niveles (buzones con sus bancos, etiqueta, estado y omitidos)
- [x] 6.4 Webhook: resolver el buzón por suscripción, validar `clientState` igual que hoy y procesar una sola vez

## 7. UI

- [x] 7.1 Reestructurar `outlook-bank-connection.tsx` en dos niveles: buzones conectados y, dentro, sus bancos, con "agregar banco a este correo" y "conectar otro correo"
- [x] 7.2 Pedir la etiqueta al conectar un banco ya conectado, sugiriendo "Personal" y "Empresa", y mostrarla como badge donde el banco aparece junto a otros
- [x] 7.3 Mostrar el estado de autorización en el buzón y heredado en sus bancos; reconexión única para todos
- [x] 7.4 Confirmación informada al desconectar: enumerar movimientos, recurrentes, cuotas e ingresos que se eliminan con las cuentas
- [x] 7.5 Reemplazar los literales `provider === "bancochile"` de `account-card.tsx` y `account-info-modal.tsx` por el criterio "no es manual", y ampliar el tipo `Provider` para admitir cualquier banco del catálogo
- [x] 7.6 Ajustar el onboarding y el botón de sincronización manual (hoy con un único banco fijo en su lista) al nuevo modelo

## 8. Verificación

- [x] 8.1 `pnpm typecheck`, `pnpm lint` y la suite `node --test` completa en verde
- [x] 8.2 Sembrar en el entorno de PR (`scripts/seed-pr-feature.ts`) lo que se puede verificar a mano con un solo banco real: un buzón migrado con su banco y el mismo banco conectado desde dos buzones con etiqueta ("Personal" y "Empresa"). El escenario de dos bancos distintos queda cubierto por tests hasta que exista BICE
- [x] 8.3 Actualizar `docs/bank-email-contract.md`: la sección "Qué falta para soportar un segundo banco" describe ahora el registry y el modelo buzón-vínculo
