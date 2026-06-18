# domain (v1)

CORE del negocio. **No importa de ninguna otra capa.**

Cada feature vive en `<feature>.domain.ts` con tres cosas:

1. **Tipos/entidades** del negocio (ej. `Budget`, `Expense`, `Goal`).
2. **Ports** — interfaces de repositorio que `infrastructure` implementará
   (ej. `interface BudgetRepository { save(b: Budget): Promise<void> }`).
3. **Errores de negocio** (ej. `BudgetExceededError`).

`_shared/` — value objects/tipos usados por varias features (ej. `Money`, `Period`).
