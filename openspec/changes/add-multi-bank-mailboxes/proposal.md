## Why

La conexión por correo está modelada como "un usuario, un banco, un buzón": `EmailConnection` guarda
en la misma fila el buzón (refresh token, `deltaLink`, suscripción) y el banco (`bankProvider` fijo
`bancochile`, `bankId`), con `@@unique([userId, bankProvider])`. Eso impide las dos cosas que el
producto necesita ahora: leer **varios bancos desde un mismo correo** (BICE llega al buzón que ya
está conectado) y leer **el mismo banco desde varios correos** (Banco de Chile personal y empresa).

Duplicar filas no sirve como atajo: dos conexiones del mismo buzón guardarían dos copias del refresh
token rotando por separado —Microsoft invalida el anterior en cada refresh, así que se pisarían y
provocarían `reauth_required` intermitentes— y abrirían una suscripción webhook por banco sobre el
mismo Inbox, procesando cada correo tantas veces como bancos haya. El buzón tiene que ser una
entidad propia.

## What Changes

- **BREAKING (interno)**: `EmailConnection` se divide en dos entidades: **buzón** (identidad OAuth,
  token cifrado, `deltaLink`, suscripción, estado de autorización) y **vínculo con un banco**
  (proveedor, banco creado, snapshot vigente, mensajes omitidos, estado de setup). Un buzón tiene N
  vínculos; un banco pertenece a un vínculo.
- Migración de datos: cada conexión existente se convierte en un buzón con un vínculo a su banco,
  conservando token, delta, suscripción, snapshot, instrumentos y movimientos. **Nadie reconecta ni
  reingresa saldos.**
- **Registry de bancos** `bankKey → { name, senders[], parse }` que reemplaza las tres llamadas
  directas a `parseBancoChileEmail`. Cada mensaje se enruta por remitente al banco que lo reclama.
  Un correo de otro banco del mismo buzón deja de contar como omitido: no es ruido, es de otro
  vínculo.
- El escaneo, la confirmación de instrumentos, la sincronización, la reconciliación y la
  desconexión pasan a operar **por vínculo**, no por usuario: desconectar un banco no toca los demás
  del mismo buzón, y desconectar el último vínculo de un buzón libera su suscripción y su token.
- Cada vínculo puede llevar una **etiqueta corta** elegida al conectar ("Empresa", "Personal"). El
  banco se muestra como "Banco de Chile Empresa" y la etiqueta aparece como badge cuando el mismo
  proveedor está conectado más de una vez. Mismo parser y misma allowlist: la etiqueta solo
  distingue el origen a la vista.
- La UI de conexión pasa a dos niveles: correos conectados y, dentro de cada uno, sus bancos, con
  "agregar banco a este correo" (sin OAuth nuevo: el buzón ya está autorizado) y "conectar otro
  correo".
- La identidad externa de las cuentas importadas (`email:acct:<ref>`, `email:card:<last4>`) pasa a
  incluir el banco. Hoy es única por usuario, así que dos bancos con el mismo número de cuenta o los
  mismos últimos 4 colisionarían.
- El origen de un banco/cuenta deja de ser el enum `manual | bancochile`: pasa a admitir la clave de
  cualquier banco del catálogo, y las superficies que hoy deciden "cuenta conectada, solo lectura"
  comparando con `"bancochile"` pasan a decidirlo por "no es manual".
- Un mismo banco SHALL NOT repetirse dentro del mismo buzón: el enrutado por remitente no podría
  decidir a cuál de los dos vínculos imputar el movimiento. Repetirlo exige otro buzón.
- Desconectar un banco pide confirmación informada: sus cuentas arrastran en cascada los ingresos,
  plantillas recurrentes y planes de cuotas que el usuario creó sobre ellas, y hoy eso se borra sin
  avisar.
- El método de conexión activo deja de ser único por `(usuario, banco)` y pasa a serlo por
  `(usuario, banco, buzón)`: el mismo banco puede venir de dos correos, pero no por dos métodos
  distintos desde el mismo correo.

## Capabilities

### New Capabilities

- `bank-email-registry`: Catálogo de bancos soportados por correo (clave, nombre, remitentes,
  parser) y enrutado de cada mensaje al banco que lo reclama. Es el contrato que debe cumplir un
  banco nuevo para entrar sin tocar los use-cases.

### Modified Capabilities

- `bank-email-connection`: Un buzón alimenta N bancos y un banco puede venir de N buzones; el ciclo
  de vida (escaneo, confirmación, sync, reconciliación, desconexión) es por vínculo banco-buzón; la
  exclusividad de método deja de ser por banco; los correos de otro banco del mismo buzón no cuentan
  como omitidos; el mismo banco conectado dos veces se distingue por etiqueta.
- `finance-model`: La identidad externa de una cuenta importada por correo es única por usuario y
  **banco**, no por usuario; y el origen (`provider`) admite cualquier banco conectado, no un único
  valor fijo.

## Impact

- `prisma/schema.prisma` y migración de datos: nuevas tablas de buzón y vínculo, reescritura de
  `email_connection`, unicidad de `bank_connection_method` y `external_id` de las cuentas importadas.
- Dominio: `arch/v1/domain/finance/email-connection.domain.ts` (tipos, ports y errores pasan a
  hablar de buzón y vínculo).
- Aplicación: `email-connection-use-cases.ts` completo (las ocho funciones dejan de usar la
  constante `BANK_PROVIDER`), más el registry nuevo junto a `bancochile-email-map.ts`.
- Infraestructura: repositorio Prisma de conexiones y el proveedor Graph (una suscripción por buzón,
  no por banco).
- HTTP: las diez rutas de `app/api/email-connection/*` reciben el vínculo o el buzón según la
  operación, incluida `renew` —la que llama el scheduler del despliegue cada 12 horas— que hoy
  consulta y actualiza `prisma.emailConnection` directamente y pasa a renovar por buzón.
- UI: `components/finance/outlook-bank-connection.tsx`, el flujo de onboarding, el botón de
  sincronización manual (que hoy ofrece un único banco fijo) y las superficies que marcan una cuenta
  como conectada (`account-card.tsx`, `account-info-modal.tsx`).
- No cambia el contrato de correo (`docs/bank-email-contract.md`): la regla de que un correo
  bancario nunca crea un ingreso se mantiene intacta y sigue siendo estructural.
- Habilita el trabajo siguiente —agregar Banco BICE— como una entrada del registry más su parser,
  sin volver a tocar los use-cases.

---

## Revisión cruzada (Claude + Codex)

**Qué revisó Codex:** los cuatro artefactos del change contra el código real del repo (rutas HTTP,
dominio de finanzas, esquema Prisma, superficies de UI y convenciones de `CLAUDE.md`).

**Aceptado y corregido:**

- La ruta `renew` quedaba fuera del alcance y consulta `prisma.emailConnection` directo, fuera del
  repositorio; además el scheduler del despliegue la llama cada 12 h → el alcance pasa de nueve a
  diez rutas, con `renew` migrada a buzones en su propia tarea (6.2) y como riesgo explícito.
- `Provider` está tipado como `manual | bancochile` y la UI decide "cuenta conectada" comparando
  contra ese literal (`account-card.tsx:58`, `account-info-modal.tsx:48`): con un segundo banco sus
  cuentas se verían editables → requisito nuevo en `finance-model`, decisión 6 en el diseño y tarea
  7.5 para eliminar los literales.
- Desconectar arrastra en cascada ingresos, recurrentes y planes de cuotas que cuelgan de las
  cuentas (`prisma/schema.prisma:296`, `:399`, `:435`) y hoy se borran sin aviso → la desconexión
  ahora exige confirmación informada con conteos (requisito, decisión 8 y tareas 4.5 y 7.4).
- Los requisitos hablaban de "dos bancos distintos en un buzón" mientras el catálogo queda con una
  sola entrada real → el catálogo se inyecta como dependencia y los tests registran un banco de
  prueba; el sembrado de PR se acota a lo verificable con un solo banco (decisión 11, tareas 1.3,
  4.8 y 8.2).

**Descartado:**

- Nada. Los cuatro hallazgos se verificaron contra el código y resultaron correctos.

**Agregado fuera de la revisión:** un banco no puede repetirse dentro del mismo buzón — dos vínculos
del mismo proveedor declararían los mismos remitentes y el enrutado no tendría cómo decidir a cuál
imputar el movimiento. Se resuelve con unicidad `(mailboxId, bankProvider)`.

**Conclusión:** el desacuerdo real fue de alcance, no de diseño: la separación buzón-vínculo y el
registry quedaron en pie, y lo que faltaba eran consumidores del modelo viejo (`renew`, el enum
`Provider`, los literales de UI) y el aviso de borrado en cascada. El riesgo que queda vivo es la
migración destructiva sobre `email_connection`: se ensaya contra un clon antes de tocar producción.
