# Clean Architecture — LucaPlan

App **fullstack Next.js 16** (App Router) con clean architecture para el backend.
Dominio: **planificación financiera** (presupuestos, gastos, metas de ahorro).

Todo vive bajo `arch/`: esta doc (copiable/pegable entre proyectos) y el código de
negocio versionado bajo `arch/v<N>/` (varias versiones conviven: `v1/`, `v2/`…).
No existe carpeta `src/`.

## Estructura

```
arch/
├─ clean-architecture.md         # esta doc
├─ shared/                       # puro, cross-version, SIN negocio (no conoce ninguna capa)
│  ├─ http/                      #   helpers HTTP genéricos
│  └─ utils/                     #   utilidades puras
└─ v1/                           # una versión del backend (v2/, v3/ conviven)
   ├─ domain/                    # CORE: no importa de ninguna otra capa
   │  ├─ budget.domain.ts        #   tipos/entidades + ports (interfaces repo) + errores de negocio
   │  ├─ expense.domain.ts
   │  ├─ goal.domain.ts
   │  └─ _shared/                #   value objects/tipos usados por varias features (ej. Money)
   ├─ application/               # use-cases. Depende SOLO de domain (+ @/arch/shared). Orquesta, no toca IO
   │  ├─ budget-use-cases/       #   carpeta por feature
   │  │  ├─ create-budget-use-case.ts
   │  │  └─ get-budget-use-case.ts
   │  └─ _shared/                #   factories/validación reusada entre use-cases
   └─ infrastructure/            # adapters que IMPLEMENTAN los ports de domain. Agrupado por tecnología
      ├─ database/prisma/        #   budget.infrastructure.ts (repos) — cuando agregues persistencia
      └─ http/<servicio>/        #   clientes HTTP a terceros

app/                             # PRESENTATION (capa HTTP de Next.js)
├─ api/<feature>/route.ts        #   Route Handlers: parsean request → invocan use-case → responden
└─ <feature>/actions.ts         #   Server Actions: misma idea para mutaciones desde RSC
```

## Regla de dependencias (se respeta siempre)

```
presentation (app/) → application → domain
infrastructure → domain          (implementa sus ports)
```

- `domain` no depende de nada.
- `infrastructure` y `presentation` **nunca** son importadas por `domain`/`application`.
- Inversión de dependencias vía **ports** definidos en `domain`. Las implementaciones
  concretas (Prisma, fetch a terceros) viven en `infrastructure` y se inyectan al use-case.
- Lo puro y sin negocio va a `arch/shared/`, no al `_shared/` de una capa.

## Mapeo con Next.js (presentation)

No duplicamos una carpeta `presentation/`: **el App Router ES la presentation**.

- `app/api/<feature>/route.ts` (Route Handlers) y los Server Actions son los entrypoints HTTP.
- Su única responsabilidad: parsear/validar el request, instanciar el repo de
  `infrastructure`, invocar el use-case de `application`, mapear el resultado/errores a HTTP.
- No meten lógica de negocio: eso vive en `application`/`domain`.

## Imports

**Dentro de `arch/` los imports cross-capa van relativos y con extensión `.ts`:**

- `import { ... } from "../../domain/budget/budget.domain.ts"`
- `import { authorize } from "../auth-use-cases/authorize-use-case.ts"`

Razón: los use-cases se prueban con `node --test` (stdlib, sin framework) y Node no
resuelve el alias `@/` (solo lo entienden Next y tsc). Con imports relativos todo el
grafo del backend corre bajo Node puro. La extensión `.ts` la exige Node en runtime y
la habilita `allowImportingTsExtensions` en `tsconfig`.

El alias `@/` queda para la **UI** (`@/components`, `@/lib`, `@/hooks`) y para cuando
`app/` (presentation) importa el backend — ahí lo resuelve Next, ej. `@/arch/v1/...`.

## Convención de nombres

| Capa           | Archivo                                   |
| -------------- | ----------------------------------------- |
| domain         | `<feature>.domain.ts`                     |
| application    | `<verbo>-<feature>-use-case.ts`           |
| infrastructure | `<feature>.infrastructure.ts`             |
| presentation   | `app/api/<feature>/route.ts` (Next.js)    |
