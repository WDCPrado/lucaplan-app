## Why

Un usuario nuevo entra a Luca Plan con **cero categorías**: no hay ninguna creación por defecto
al registrarse (las listas de `prisma/seed.ts` y `scripts/seed-pr.ts` son solo de dev/PR). Eso
rompe los dos flujos que vienen justo después:

- El paso `triage` del onboarding le pide categorizar los ~8 comercios más frecuentes sin que
  exista una sola categoría contra la cual elegir.
- La categorización con IA recibe la lista de categorías del usuario (nombre + descripción) como
  única opción válida; con lista vacía no puede acertar nada por definición.

El resultado es que el setup inicial exige inventar categorías a mano, una por una, antes de que
la app sirva de algo.

## What Changes

- Al **crear la cuenta** por el sistema de autenticación, el sistema siembra un conjunto fijo de
  categorías por defecto pensadas para Chile (10, incluyendo una de tipo `income`).
- Cada categoría por defecto trae `description` escrita como **contexto para el prompt de
  categorización IA**, no como texto decorativo: es la palanca de precisión, no el nombre.
- La siembra es **idempotente**, **atómica** (se crea el conjunto completo o ninguna) y no bloquea
  el registro: si el usuario ya tiene categorías no hace nada, y si falla, la cuenta igual queda
  creada.
- **No** se siembran `CategoryLimit` ni presupuesto global: el sistema no inventa cifras que el
  usuario no eligió; los define en el paso de presupuesto.
- El usuario puede **agregar** categorías durante el paso `triage` del onboarding, que ya monta
  `CategoryModal` en modo creación; editarlas o eliminarlas se sigue haciendo desde la UI de
  presupuesto. No se agregan pasos ni pantallas nuevas.

Fuera de alcance (quedan en WDC-36 como tarjetas aparte):

- Cuestionario conversacional de onboarding ("¿en qué gastas el sueldo?"). El onboarding importa
  movimientos reales del correo **antes** de ese punto: preguntar a mano lo que ya está en la base
  agrega fricción justo donde se abandona.
- Creación de cuotas dentro del onboarding.

## Capabilities

### New Capabilities

- `default-categories`: conjunto de categorías sembradas al crear la cuenta — cuáles son, cuándo
  se crean, idempotencia, tolerancia a fallos y su rol como contexto para la categorización IA.

### Modified Capabilities

Ninguna. `onboarding-flow` y `ai-categorization` no cambian sus requisitos: esta capacidad les
provee el dato que hoy les falta.

## Impact

- **Application**: nuevo use-case de siembra en `arch/v1/application/finance-use-cases/`, sobre el
  `CategoryRepository` existente. No cambia el schema Prisma.
- **Domain / Infrastructure**: `CategoryRepository` gana un `createMany` (inserción en una sola
  sentencia, con `skipDuplicates`) para que la siembra sea atómica; lo implementa el adapter
  Prisma de finanzas.
- **Infrastructure**: `arch/v1/infrastructure/auth/auth.ts` gana el hook de creación de usuario de
  Better Auth (1.6.19) que invoca el use-case.
- **Scripts**: `scripts/seed-pr.ts` crea su usuario demo con `auth.api.signUpEmail`, así que
  pasará a recibir las categorías por defecto antes de crear las suyas con `prisma.category.create`.
  Seis nombres coinciden (Supermercado, Transporte, Suscripciones, Salud, Compras, Sueldo) y con
  `@@unique([userId, name])` eso **tumbaría el seed del entorno de PR** si no se ajusta.
  `prisma/seed.ts` no se ve afectado: inserta el usuario directo con Prisma, sin pasar por auth.
- **Sin migración**: no hay cambios de schema. Los usuarios existentes no se tocan; para ellos
  sigue estando `pnpm seed:categories --email=…`.

---

## Revisión cruzada (Claude + Codex)

**Qué revisó Codex:** los cuatro artefactos del change contra el código real del repo, buscando
afirmaciones falsas, huecos, sobre-diseño y choques con las convenciones de arquitectura.

**Aceptado y corregido:**

- *El hook no cubre `prisma/seed.ts`* → el requisito ya no promete "cualquier camino de alta":
  cubre las altas gestionadas por Better Auth y dice explícitamente que las inserciones directas
  con Prisma no lo disparan.
- *Una categoría sin límite ya vale 0, no "sin definir"* → `effectiveLimit` devuelve `Money.zero`
  sin registros (`budget-formulas.ts`); la distinción `null` es solo del límite global. Se
  reescribió la justificación: no se siembran límites porque el sistema no inventa cifras, no por
  una distinción que el modelo no hace.
- *El triage no edita ni borra categorías* → el modal se monta con `category={null}`
  (`onboarding-flow.tsx:136`), así que ahí solo se crea. Corregido en proposal y spec.
- *No existe desactivar categorías* → `isActive` está en Prisma pero no en el dominio; se quitó
  del spec.
- *Un fallo a mitad deja el conjunto incompleto* → la siembra pasa a ser atómica: `createMany` en
  una sola sentencia, con un método nuevo en el port. Nuevo escenario "todo o nada".
- *El seed de PR crea 9 categorías, no 8* → corregido, con los seis nombres que chocan y el
  detalle de que el `deleteMany` actual solo cubre la rama `SEED_PR_FORCE`.
- *Usuarios existentes con cero categorías* → decisión explícita de no hacer backfill, apoyada en
  que `pnpm seed:categories --email=…` ya resuelve el caso a mano.
- *No importar el catálogo TSX de iconos desde `application`* → los valores van como literales.

**Descartado:**

- *"`auth.ts` no debe importar `application`; muévelo a un composition root en presentation"* → la
  regla escrita dice eso, pero el repo ya practica lo contrario:
  `arch/v1/infrastructure/database/prisma/push-deps.ts` compone adapters e invoca use-cases desde
  infraestructura, y de ahí comen el cron y `scripts/notify-due.ts`. Mover el wiring de Better
  Auth a presentation obligaría a desmontar el singleton `auth` que importa medio repo, a cambio
  de nada. Se mantiene el hook y se corrige la fuente canónica (tarea 3.3), que es lo que manda
  el CLAUDE.md cuando spec y doc se contradicen.

**Conclusión:** coincidimos en que el punto de disparo y el alcance acotado están bien, y en que
el spec original prometía garantías que el modelo no da (límite "no definido", edición en triage,
desactivación) más una siembra sin atomicidad. Queda vivo un riesgo menor: el seed de PR depende
de que la tarea 4.1 se pruebe en local antes de abrir el PR — si se salta, el entorno efímero se
levanta sin datos.
