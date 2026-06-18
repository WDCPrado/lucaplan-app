# application (v1)

Use-cases. Depende **solo** de `domain` (+ `@/arch/shared`). Orquesta el negocio,
**no toca IO directamente**: recibe los ports de `domain` por inyección.

- Una carpeta por feature: `<feature>-use-cases/`.
- Un archivo por caso de uso: `<verbo>-<feature>-use-case.ts`
  (ej. `create-budget-use-case.ts`, `record-expense-use-case.ts`).

`_shared/` — factories/validación reutilizada entre use-cases.
