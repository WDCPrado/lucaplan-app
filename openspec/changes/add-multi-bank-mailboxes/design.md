## Context

`EmailConnection` es hoy una sola fila que mezcla dos cosas con ciclos de vida distintos: la
autorización de un buzón de Outlook (refresh token cifrado, `deltaLink`, suscripción webhook,
estado `pending_setup | active | reauth_required | error`) y la relación con un banco (`bankProvider`
con default `bancochile`, `bankId`, `lastBalanceReconciledAt`, `skippedCount`). El `@@unique([userId,
bankProvider])` cierra la puerta a repetir un banco, y `BankConnectionMethod` repite ese mismo unique.

En la capa de aplicación la constante `BANK_PROVIDER = "bancochile"` está incrustada en las ocho
funciones de `email-connection-use-cases.ts`, y `parseBancoChileEmail` se llama directo en tres
puntos (escaneo, confirmación, sync). El contrato de correo ya anticipa este momento y señala el
mapa `bankKey → parser` como la primera pieza a mover antes de escribir una sola regex nueva.

El disparador es Banco BICE, pero el requisito que lo enmarca es más amplio: un correo puede
alimentar varios bancos y un banco puede llegar por varios correos (personal y empresa).

## Goals / Non-Goals

**Goals:**

- Un buzón autorizado una vez puede alimentar N bancos; agregar el segundo banco no exige otro OAuth.
- Un mismo banco puede venir de N buzones, distinguibles a la vista sin cambiar su parser.
- Lo ya conectado sigue funcionando tras la migración: sin reconectar, sin reingresar snapshot, sin
  perder instrumentos ni movimientos.
- Agregar un banco nuevo es una entrada del registry más su parser; los use-cases no se tocan.
- Un correo de otro banco del mismo buzón no se contabiliza como mensaje omitido.

**Non-Goals:**

- Escribir el parser de BICE (cambio siguiente, ya con correos reales a la vista).
- Soportar otro proveedor de correo además de Outlook.
- Fusionar en un solo banco las cuentas del mismo proveedor llegadas por buzones distintos.
- Cambiar el contrato de correo: un correo bancario sigue sin poder crear un ingreso.
- Reconciliar o deduplicar movimientos entre dos vínculos del mismo proveedor.

## Decisions

### 1. El buzón es una entidad; el banco cuelga de él

`EmailMailbox` (uno por correo autorizado) guarda identidad OAuth, token cifrado, `deltaLink`,
suscripción y estado de autorización. `EmailBankLink` (uno por banco de ese buzón) guarda
`bankProvider`, `bankId`, etiqueta, snapshot vigente, mensajes omitidos y estado de setup.

*Alternativa descartada:* dejar la tabla plana y relajar el unique a `(userId, emailAddress,
bankProvider)`. Es una migración más chica, pero cada fila seguiría teniendo su propio token: dos
filas del mismo buzón rotarían el refresh token por separado y Microsoft invalida el anterior en
cada refresh, así que se expulsarían mutuamente a `reauth_required`. Además abriría una suscripción
webhook por banco sobre el mismo Inbox y procesaría cada correo una vez por banco. El ahorro de
migración no compensa un fallo intermitente de autenticación.

### 2. Un sync por buzón que reparte entre sus vínculos

El delta y el webhook son del buzón, así que la sincronización deja de ser "por usuario y banco" y
pasa a ser: traer los mensajes nuevos una vez, enrutar cada uno por remitente al vínculo que lo
reclama, y aplicar el resultado sobre los instrumentos de ese vínculo. Un buzón con tres bancos lee
su Inbox una vez, no tres.

La suscripción webhook se resuelve contra el buzón (`findBySubscriptionId` devuelve el buzón), y el
`clientState` se sigue validando igual.

### 3. Registry `bankKey → { name, senders, parse }`

Un módulo con el catálogo de bancos soportados y una función de enrutado que, dado un mensaje,
devuelve el `bankKey` cuyo remitente lo reclama, o `null`. Los use-cases piden el parser por clave y
dejan de importar `parseBancoChileEmail`.

Consecuencia sobre el conteo de omitidos: hoy todo lo que no parsea suma a `skippedCount`. Con
varios bancos en un buzón eso convertiría los correos de BICE en "omitidos" de Banco de Chile. El
enrutado ocurre **antes** del parseo: un mensaje que pertenece a otro vínculo simplemente no entra
al pipeline de este, y un mensaje que no reclama ningún banco (newsletters, personal) se cuenta en
el buzón, no en un banco. Los motivos de omisión existentes (`sin_monto`, `sin_instrumento`, …)
siguen siendo del vínculo, que es donde son accionables.

### 4. Un banco por vínculo, diferenciado por etiqueta

Banco de Chile personal y Banco de Chile empresa son dos `Bank` distintos, cada uno con sus cuentas.
No se fusionan: sus instrumentos, snapshots y desconexiones son independientes, y mezclarlos
obligaría a decidir qué pasa al desconectar solo uno.

Para que no aparezcan dos filas idénticas llamadas "Banco de Chile", el vínculo lleva una etiqueta
corta que el usuario elige al conectar. Es **obligatoria cuando ya existe otro vínculo del mismo
proveedor** y opcional cuando es el primero. El nombre visible del banco es `<nombre del registry>
<etiqueta>` ("Banco de Chile Empresa") y la etiqueta se muestra además como badge en las superficies
donde el banco aparece junto a otros.

*Sobre "empresa" como concepto:* no se infiere del correo ni del contenido. Es una etiqueta del
vínculo, no un atributo del banco ni una variante del parser. Si en la práctica los avisos de una
cuenta empresa llegaran desde remitentes distintos a los de la cuenta personal, eso se resuelve
agregando esos remitentes a la allowlist del **mismo** `bankKey` en el registry —el parser y el
efecto financiero son idénticos— sin tocar el modelo. No se asume ni una cosa ni la otra sin
correos reales a la vista.

### 5. La identidad externa de las cuentas incluye el banco

`FinancialAccount` es única por `(userId, externalId)` y las cuentas importadas usan
`email:acct:<ref>` / `email:card:<last4>`. Con dos bancos, dos cuentas con el mismo número o los
mismos últimos 4 colisionan y la segunda importación falla o pisa a la primera. El externalId pasa a
llevar el banco (`email:<bankKey>:acct:<ref>`), y la migración reescribe los existentes.

Es seguro: el externalId de la cuenta se usa para resolver instrumentos, mientras que los movimientos
cuelgan de la cuenta por clave foránea y su propia identidad (`@@unique([accountId, externalId])`) no
cambia. Ningún movimiento se re-identifica.

### 6. El origen deja de ser un enum de un solo banco

`Provider` está tipado como `manual | bancochile` y la UI decide "cuenta conectada, solo lectura"
comparando contra el literal `"bancochile"` (`components/finance/account-card.tsx:58`,
`components/finance/account-info-modal.tsx:48`). Con un segundo banco, sus cuentas se verían como
manuales y editables: un movimiento importado podría borrarse desde la UI.

El origen pasa a admitir cualquier clave del catálogo, y el criterio de "conectada" pasa a ser
`provider !== "manual"` —que es lo que la regla siempre quiso decir— o `connectionMethod === "email"`
donde se necesite el método. Los literales `"bancochile"` en superficies desaparecen; el nombre
visible sale del catálogo, no de un condicional.

### 7. Un banco no se repite dentro del mismo buzón

Dos vínculos del mismo proveedor en el mismo buzón harían el enrutado ambiguo: los dos declaran los
mismos remitentes y no hay forma de decidir a cuál imputar el movimiento sin adivinar. La unicidad
`(mailboxId, bankProvider)` lo impide en la base. Repetir un banco exige otro buzón, que es
exactamente el caso personal/empresa que motiva la etiqueta.

### 8. Desconectar avisa lo que arrastra

Las cuentas importadas pueden tener colgados datos que el usuario creó a mano: fuentes de ingreso,
plantillas recurrentes y planes de cuotas cuelgan de `FinancialAccount` con `onDelete: Cascade`
(`prisma/schema.prisma:296`, `:399`, `:435`), y `deleteBank` borra el banco entero. Hoy eso se pierde
en silencio; con varios bancos por buzón la desconexión deja de ser un evento excepcional y el
silencio se vuelve inaceptable.

La desconexión no cambia de semántica —sigue borrando el banco y sus datos— pero pasa a exigir
confirmación informada: la UI enumera qué se va a perder (cuántos movimientos, recurrentes, cuotas e
ingresos asociados) antes de ejecutar. No se bloquea la desconexión ni se migran esos datos a otra
cuenta: el usuario decide con la información a la vista.

### 9. La exclusividad de método se vuelve por buzón

`BankConnectionMethod` pasa a ser único por `(userId, bankProvider, mailboxId)`. Sigue impidiendo
que un mismo banco tenga dos métodos a la vez desde el mismo origen, que es lo que la regla protege,
sin bloquear el mismo banco desde otro correo.

### 10. Desconexión en dos niveles

Desconectar un banco borra su vínculo y sus datos financieros, y deja intactos los demás bancos del
buzón. Cuando se va el último vínculo, el buzón elimina su suscripción, descarta el token y
desaparece. Desconectar un buzón completo es el atajo que hace ambas cosas.

### 11. Cómo se prueba "dos bancos" sin un segundo banco real

Este cambio deja el catálogo con una sola entrada real (`bancochile`); BICE llega después. Para que
los requisitos de multi-banco no queden sin verificar, el catálogo se inyecta como dependencia de
los use-cases —igual que el resto de ports— y los tests registran un banco de prueba con sus propios
remitentes. Así se ejercita el enrutado, el reparto en una pasada y el conteo de omitidos por
vínculo sin esperar a tener correos reales de otro banco.

El sembrado del entorno de PR, en cambio, no puede inventar un banco: se limita a lo verificable a
mano —un buzón migrado con su banco y el mismo banco conectado desde dos buzones con etiqueta— y el
escenario de dos bancos distintos se verifica ahí recién con BICE.

## Risks / Trade-offs

- **La migración toca datos financieros vivos.** → Una sola migración transaccional: crear buzón y
  vínculo desde cada `email_connection`, reescribir los `external_id` de sus cuentas y recién
  entonces eliminar la tabla vieja. Verificación previa en un clon de la base de producción
  (`pnpm clone:db`), y prueba explícita de que tras migrar el refresco manual sincroniza sin
  reautorizar ni duplicar movimientos.
- **Un buzón con varios bancos concentra un punto de fallo:** si su token muere, todos sus bancos
  quedan en `reauth_required`. → Es inherente a compartir la autorización; el estado se muestra en
  el buzón y sus bancos lo heredan a la vista, para que el usuario entienda que reconecta una vez y
  se arreglan todos.
- **Etiquetas ambiguas** ("Banco de Chile" y "Banco de Chile 2"). → La etiqueta es obligatoria a
  partir del segundo vínculo del mismo proveedor y se sugieren "Personal" y "Empresa" como valores.
- **Superficie de cambio grande** (dominio, aplicación, infraestructura, nueve rutas y la UI de
  conexión, 1134 líneas). → El registry y la separación buzón/vínculo se implementan en ese orden,
  y los tests existentes de `email-connection.test.ts` funcionan como red: sus escenarios deben
  seguir pasando con un solo buzón y un solo banco antes de tocar la UI.
- **Regresión silenciosa en el conteo de omitidos.** → Test explícito: un buzón con dos bancos donde
  el correo de uno no incrementa el `skippedCount` del otro.
- **Cuentas del segundo banco tratadas como manuales.** Si queda algún literal `"bancochile"` en la
  UI, las cuentas de otro banco se mostrarían editables y sus movimientos importados podrían
  borrarse a mano. → Barrido de los literales antes de cerrar el cambio; el criterio queda en un
  solo lugar (`provider !== "manual"`).
- **El scheduler renueva contra una tabla que ya no existe.** `renew` consulta `prisma.emailConnection`
  directo, fuera del repositorio. → Migrarla junto con el esquema, en el mismo paso, y probar la ruta
  con su secreto antes del deploy.

## Migration Plan

1. Migración de esquema y datos en una transacción: `email_mailbox` y `email_bank_link` nuevas; una
   fila de cada una por cada `email_connection` existente (token, delta, suscripción y estado al
   buzón; banco, snapshot y omitidos al vínculo); reescritura de `external_id` en las cuentas
   importadas; nuevo unique de `bank_connection_method`; drop de `email_connection`.
2. Dominio y registry, con `bancochile` como única entrada.
3. Use-cases por vínculo, manteniendo verde `email-connection.test.ts`.
4. Infraestructura (repositorios y proveedor Graph por buzón) y rutas HTTP.
5. UI en dos niveles y onboarding.
6. Verificación en entorno de PR con datos sembrados: un buzón con un banco (caso migrado) y un
   buzón con dos bancos, incluido el mismo proveedor repetido con etiqueta.

**Rollback:** la migración es destructiva sobre `email_connection`, así que el rollback real es
restaurar el respaldo previo a la migración; por eso el paso 1 se ensaya antes contra un clon.

## Open Questions

- Ninguna que bloquee la implementación. Queda por confirmar con correos reales si una cuenta
  empresa de Banco de Chile usa los mismos remitentes que la personal; el diseño funciona igual en
  ambos casos (misma allowlist o remitentes añadidos al mismo `bankKey`), así que no condiciona el
  trabajo.
