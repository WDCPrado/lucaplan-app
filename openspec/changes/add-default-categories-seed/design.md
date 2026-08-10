## Context

Hoy nadie crea categorías para un usuario nuevo. Lo que existe:

- `CategoryRepository` (`arch/v1/domain/finance/finance.domain.ts`) expone `listByUser`, `upsert`,
  `delete` y los métodos de límite; el adapter Prisma los implementa en `finance.infrastructure.ts`.
  `upsert` sin `id` es un `prisma.category.create` suelto: N llamadas son N transacciones.
- `Category` tiene `name`, `type`, `icon`, `color`, `description` y `@@unique([userId, name])`.
  `isActive` existe en Prisma pero el dominio no lo expone, así que hoy no se puede desactivar.
- `openai-categorization.provider.ts` manda al modelo `{ nombre, descripcion }` de cada categoría,
  más las pistas de comercio (`MERCHANT_INDEX`) y las correcciones aprendidas.
- Better Auth 1.6.19 (`arch/v1/infrastructure/auth/auth.ts`) construye la instancia sin
  `databaseHooks`.
- `scripts/seed-pr.ts` crea el usuario demo con `auth.api.signUpEmail` y después crea 9 categorías
  propias con `prisma.category.create` (8 de gasto + `Sueldo`).
- `scripts/seed-categories.ts` (`pnpm seed:categories --email=…`) siembra a mano el set personal
  del dueño de la cuenta, con descripciones para la IA. Es la vía existente para un usuario ya
  creado; no es un set genérico para cuentas nuevas.
- El triage del onboarding monta `CategoryModal` con `category={null}`: desde ahí se **crea**, no
  se edita ni se borra.

## Goals / Non-Goals

**Goals:**

- Que un usuario recién creado tenga categorías utilizables sin tocar nada.
- Que la IA tenga contexto real (descripciones chilenas) desde la primera categorización.
- Cero pasos nuevos de UI y cero cambios de schema.

**Non-Goals:**

- Cuestionario de onboarding y cuotas en onboarding (fuera de alcance, ver proposal).
- Sembrar límites, presupuesto global, cuentas o bancos.
- Retro-sembrar usuarios existentes.
- Reemplazar `MERCHANT_INDEX` ni la corrección aprendida: son mecanismos complementarios.

## Decisions

### 1. Dispara en `databaseHooks.user.create.after` de Better Auth

Un único punto que cubre todos los caminos de alta (registro por email, `admin.createUser`,
scripts que usan `auth.api.signUpEmail`), sin tocar la UI ni el dashboard.

- *Alternativa descartada — siembra perezosa en el primer render del dashboard*: se ejecuta en
  cada carga (aunque sea para leer y salir), mete lógica de escritura en un server component y
  obliga a decidir qué pasa con el usuario que borró todas sus categorías a propósito.
- *Alternativa descartada — endpoint explícito llamado por el onboarding*: agrega ruta, fetch y
  estado de error a un flujo que ya tiene cinco pasos.

El hook envuelve la llamada en `try/catch`: un fallo de la siembra **no** puede tumbar el
registro (el spec lo exige). Se registra por consola, igual que el resto de fallos no fatales.

### 2. Un use-case en `application` con la lista como constante, y un `createMany` en el port

`arch/v1/application/finance-use-cases/seed-default-categories-use-case.ts` exporta
`DEFAULT_CATEGORIES` (datos puros) y `seedDefaultCategories(deps, userId)`, que:

1. `deps.categories.listByUser(userId)`; si devuelve algo, retorna sin escribir (idempotencia).
2. Si no, **una sola** llamada `deps.categories.createMany(...)` con el set completo.

`CategoryRepository` gana `createMany(inputs: CategoryInput[]): Promise<void>`, implementado con
`prisma.category.createMany({ data, skipDuplicates: true })`. Es una sentencia: o entran las 10 o
no entra ninguna, que es lo que exige el spec. La alternativa —diez `upsert` sueltos, sin tocar el
port— deja conjuntos parciales que ningún reintento completa, porque el guard por `listByUser`
encuentra las que sí entraron y se salta el resto. Tres líneas de adapter compran esa garantía;
un `$transaction` costaría más y obligaría a filtrar el cliente Prisma por el port.

El guard por `listByUser` es la idempotencia visible en el spec; `skipDuplicates` es el cinturón
frente a `@@unique([userId, name])`.

Testeable con `node --test` y un repo fake en memoria.

### 3. `auth.ts` invoca el use-case, como ya hace `push-deps.ts`

`auth.ts` importará el use-case y `categoryRepository` de su vecino de infraestructura. No es una
excepción inventada para este cambio: `arch/v1/infrastructure/database/prisma/push-deps.ts` ya
compone adapters e invoca use-cases de `application` desde infraestructura, y es lo que consumen
el cron de recordatorios y `scripts/notify-due.ts`. Better Auth cumple aquí el mismo papel de
**adaptador conductor** que `app/`: recibe un evento externo y llama a un caso de uso.

No se usa `financeDeps` porque vive en `presentation` y arrastraría los providers de OpenAI y de
tipo de cambio a la construcción de la instancia de auth.

La regla escrita en `arch/clean-architecture.md` y `arch/v1/infrastructure/README.md` dice que las
implementaciones "se instancian en presentation", sin mencionar este patrón — por eso se lee como
violación. Se corrige la fuente canónica con una frase que reconozca el wiring en infraestructura,
en vez de dejar la excepción declarada solo aquí.

### 4. Contenido del set (10 categorías)

| Nombre                   | Tipo    | Icono          | Color     |
| ------------------------ | ------- | -------------- | --------- |
| Sueldo                   | income  | `Wallet`       | `#10b981` |
| Supermercado             | expense | `ShoppingCart` | `#f97316` |
| Restaurantes y delivery  | expense | `Utensils`     | `#ef4444` |
| Transporte               | expense | `Car`          | `#3b82f6` |
| Salud                    | expense | `Stethoscope`  | `#06b6d4` |
| Cuentas y servicios      | expense | `Zap`          | `#eab308` |
| Arriendo o dividendo     | expense | `House`        | `#6366f1` |
| Suscripciones            | expense | `CreditCard`   | `#a855f7` |
| Compras                  | expense | `ShoppingBag`  | `#ec4899` |
| Entretenimiento          | expense | `Film`         | `#84cc16` |

Los nombres de icono y los colores se copian **como literales** del catálogo
`CATEGORY_ICONS` / `CATEGORY_COLORS` (`components/finance/category-icons.tsx`); `DEFAULT_CATEGORIES`
vive en `application` y no importa ese archivo, que es TSX y arrastra `lucide-react`. Un nombre de
icono fuera del catálogo se renderiza como genérico.

Las `description` se redactan como contexto para el modelo, nombrando comercios chilenos
reales — p. ej. Supermercado: *"Compras de supermercado y almacén: Líder, Jumbo, Santa Isabel,
Unimarc, Tottus, ferias y minimarkets."* Ese campo es lo que mueve la precisión, no el nombre.

Sin categoría "Otros": un cajón genérico invita al modelo a vaciar ahí lo dudoso. Lo que no
encaja queda sin categoría y lo resuelve el triage, que es donde el usuario enseña.

### 5. `scripts/seed-pr.ts` deja de chocar

Con el hook activo, el usuario demo nace con las 10 por defecto y luego el script crea las suyas:
coinciden Supermercado, Transporte, Suscripciones, Salud, Compras y Sueldo, y esos nombres violan
`@@unique([userId, name])` → **el seed del entorno de PR se cae**. Hoy el `deleteMany` de
categorías solo existe en la rama `SEED_PR_FORCE`, no en la de usuario nuevo. Se mueve a después
de resolver el usuario, para ambos caminos: el set del PR queda intacto y determinista.

`prisma/seed.ts` no necesita cambios: inserta el usuario con `prisma.user.create`, no pasa por
Better Auth y además borra las categorías del usuario antes de sembrar las suyas.

## Risks / Trade-offs

- **El hook rompe el registro si falla** → `try/catch` con log; el spec fija que la cuenta queda
  creada igual.
- **Un fallo a mitad deja un conjunto incompleto que nadie completa** → `createMany` en una sola
  sentencia (decisión 2): o entran todas o ninguna, y el usuario sin categorías al menos ve el
  estado vacío conocido en vez de un set mutilado.
- **El seed de PR se cae por nombres duplicados** → decisión 5; se prueba en local con
  `SEED_PR_FORCE=1 RAILWAY_ENVIRONMENT_NAME=pr-0 pnpm seed:pr` antes del PR.
- **Categorías que el usuario no usa ensucian el dashboard y le dan opciones de más al modelo** →
  el set se mantiene en 10 y el triage del onboarding es el momento natural para borrar las que
  sobran.
- **La lista queda hardcodeada en el código** → es el punto: cambiarla es editar una constante y
  no afecta a usuarios ya sembrados. Si algún día hay que versionarla, se verá entonces.
- **Usuarios existentes con cero categorías siguen así** → decisión consciente: sin backfill
  automático. La app en producción tiene un puñado de cuentas y para ellas ya existe
  `pnpm seed:categories --email=…`. Un backfill idempotente cuesta más que ejecutar ese comando.

## Migration Plan

Sin migración de base de datos ni backfill. Se despliega con el código; el efecto aparece en la
siguiente cuenta creada. Rollback = revertir el commit (las categorías ya sembradas quedan y se
comportan como cualquier otra).

## Open Questions

Ninguna bloqueante. Los textos exactos de `description` se afinan al implementar; el criterio es
"comercios y conceptos chilenos reconocibles en la descripción del movimiento bancario".
