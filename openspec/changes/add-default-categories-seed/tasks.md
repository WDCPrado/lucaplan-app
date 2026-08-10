## 1. Port y adapter

- [x] 1.1 Agregar `createMany(inputs: CategoryInput[]): Promise<void>` a `CategoryRepository`
      (`arch/v1/domain/finance/finance.domain.ts`).
- [x] 1.2 Implementarlo en `arch/v1/infrastructure/database/prisma/finance.infrastructure.ts` con
      `prisma.category.createMany({ data, skipDuplicates: true })` — una sola sentencia, para que
      la siembra sea todo o nada.

## 2. Use-case y set por defecto

- [x] 2.1 Crear `arch/v1/application/finance-use-cases/seed-default-categories-use-case.ts` con la
      constante `DEFAULT_CATEGORIES` (las 10 del design: nombre, `type`, `icon` y `color` copiados
      como literales del catálogo de la UI, sin importarlo) y las `description` redactadas con
      comercios chilenos.
- [x] 2.2 Implementar `seedDefaultCategories(deps: { categories: CategoryRepository }, userId)`:
      sale sin escribir si `listByUser` devuelve alguna categoría; si no, un único `createMany`.
- [x] 2.3 Test `arch/v1/application/finance-use-cases/seed-default-categories.test.ts` con repo
      fake en memoria: siembra 10 en usuario vacío en una sola llamada; no escribe nada si ya hay
      ≥1 categoría; todas con `description` no vacía; una de tipo `income`; ninguna genérica tipo
      "Otros"; nombres únicos; si `createMany` lanza, no queda nada persistido.

## 3. Disparo en la creación de la cuenta

- [x] 3.1 Agregar `databaseHooks.user.create.after` en `arch/v1/infrastructure/auth/auth.ts`
      invocando el use-case con `categoryRepository`.
- [x] 3.2 Envolver la llamada en `try/catch` con log por consola: un fallo de la siembra no
      interrumpe el registro ni el login.
- [x] 3.3 Documentar el patrón de wiring en infraestructura (precedente: `push-deps.ts`) con una
      frase en `arch/clean-architecture.md` y en `arch/v1/infrastructure/README.md`, para que
      invocar un use-case desde un adaptador conductor deje de leerse como violación de la regla.

## 4. Seed de PR

- [x] 4.1 En `scripts/seed-pr.ts`, mover el borrado de categorías del usuario a después de
      resolverlo, para que también corra en el camino de usuario nuevo: si no, los seis nombres
      repetidos violan `@@unique([userId, name])` y el seed del entorno de PR se cae.
- [x] 4.2 Verificar en local: `SEED_PR_FORCE=1 RAILWAY_ENVIRONMENT_NAME=pr-0 pnpm seed:pr` corre
      completo, tanto con usuario nuevo como en re-siembra.

## 5. Verificación

- [x] 5.1 Registrar una cuenta nueva en local (por `auth.api.signUpEmail`, el mismo camino del
      registro) y comprobar el estado sembrado: 10 categorías con icono, color y descripción, 0
      `CategoryLimit` y 0 `MonthlyBudget`; una segunda pasada del use-case no duplica nada.
- [x] 5.2 Comprobar que la categorización con IA recibe las descripciones sembradas: el use-case
      pasa `categories.listByUser` al provider y `buildUserPrompt` emite `descripcion` por cada
      categoría (`openai-categorization.provider.ts`); las sembradas traen descripción no vacía.
- [x] 5.3 `pnpm lint && pnpm typecheck && node --test "arch/**/*.test.ts"`.
- [x] 5.4 Reescribir `scripts/seed-pr-feature.ts` para que cree una **segunda cuenta** por Better
      Auth y la deje intacta: el usuario demo del seed base no sirve como muestra (se le borran las
      categorías por defecto) y el entorno de PR puede tener el registro cerrado.
