// Memoización de lecturas por request, para el punto donde se bindean los adapters. No cambia
// ninguna firma de use-case ni toca el dominio: envuelve los métodos de lectura del objeto de
// deps, así que quien los llama no se entera.
//
// El problema que resuelve: una misma carga arma varias vistas (resumen, presupuesto, movimientos,
// ingresos) y cada una pide por su cuenta las categorías, sus límites, los presupuestos y demás.
// Son datos del usuario que no dependen de la vista, así que la segunda lectura idéntica vuelve a
// la base por lo mismo. Con `getPreviousMonthDebt` leyendo además el mes anterior con la misma
// vista, se duplican todas menos la de movimientos del período.
//
// Quién lo usa NO es una decisión de este archivo: `finance-http.ts` expone dos objetos de deps y
// solo el de las páginas pasa por acá. Ver el comentario de ahí.
import type {
  AccountRepository,
  BalanceBucketRepository,
  BankRepository,
  CategoryRepository,
  MonthlyBudgetRepository,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts"
import type { IncomeRepository } from "../../domain/finance/income.domain.ts"
import type { InstallmentPlanRepository } from "../../domain/finance/installment.domain.ts"
import type { RecurringTemplateRepository } from "../../domain/finance/recurring.domain.ts"
import type { BudgetPeriodRepository } from "../../domain/finance/budget-period.domain.ts"

export type MemoStore = Map<string, Promise<unknown>>

/**
 * Los puertos que la tabla de abajo nombra, con la clave con la que se inyectan. Existe para que
 * los nombres de `READS` estén atados a algo que el compilador revise: renombrar un método del
 * puerto (o la clave con la que se bindea) rompe el build en vez de apagar la memoización en
 * silencio y devolver el dashboard a sus 35 lecturas sin que nadie se entere.
 */
export type MemoizedPorts = {
  accounts: AccountRepository
  banks: BankRepository
  balanceBuckets: BalanceBucketRepository
  categories: CategoryRepository
  monthlyBudgets: MonthlyBudgetRepository
  transactions: TransactionRepository
  incomes: IncomeRepository
  installments: InstallmentPlanRepository
  recurring: RecurringTemplateRepository
  budgetPeriod: BudgetPeriodRepository
}

// Lecturas de solo lectura, por usuario, que un mismo render pide idénticas más de una vez.
//
// NO están acá a propósito: `transactions.searchByUser` y `transactions.amountBounds` (se llaman
// una sola vez por carga), `incomes.hasGeneratedFor` (un argumento distinto por ingreso, no hay
// repetición que ahorrar) y `recurring.listActiveByUser` (la usa la materialización de períodos,
// que escribe).
const READS = {
  accounts: ["listByUser"],
  banks: ["listByUser"],
  balanceBuckets: ["listByUser"],
  categories: ["listByUser", "listLimitsByUser"],
  monthlyBudgets: ["listByUser"],
  transactions: ["listByUserPeriod"],
  incomes: ["listByUser", "listAmountsByUser"],
  installments: ["listByUser"],
  recurring: ["listByUser"],
  // Modo y cierres: cada vista del mes resuelve su rango con esto, y un render arma varias.
  budgetPeriod: ["get"],
} satisfies { [R in keyof MemoizedPorts]: readonly (keyof MemoizedPorts[R])[] }

/**
 * Devuelve `deps` con esas lecturas memoizadas: dentro de un mismo ámbito, la misma llamada con los
 * mismos argumentos va a la base UNA vez y las demás reciben esa misma promesa.
 *
 * `scope` entrega el almacén del ámbito en curso. Si devuelve uno nuevo en cada llamada no memoiza
 * nada y el comportamiento es el de siempre; ese modo degradado está cubierto por test, pero NO es
 * lo que separa lecturas de escrituras: eso lo hace el binding (`financeDeps` crudo vs.
 * `financePageDeps` memoizado), no dónde acabe corriendo el código.
 *
 * ponytail: la clave es el nombre del método más `JSON.stringify` de los argumentos. Alcanza porque
 * todos los argumentos de estas lecturas son strings, números o el rango del mes
 * (`{ start, end }`, que siempre se arma con las claves en ese orden). Si alguna pasara a recibir un
 * objeto con orden de claves variable, habría que darle una clave propia.
 *
 * ponytail: `{ ...repo }` asume que los adapters son objetos literales, que es lo que son hoy todos
 * los de `infrastructure/database/prisma/`. Una instancia de clase perdería los métodos de su
 * prototipo al copiarse así; si algún adapter pasa a serlo, hay que envolverlo con `Object.create`
 * sobre su prototipo o con un `Proxy`.
 */
export function memoizeReads<T extends MemoizedPorts>(
  deps: T,
  scope: () => MemoStore
): T {
  const out = { ...deps } as unknown as Record<string, Record<string, unknown>>
  for (const [repoName, methods] of Object.entries(READS)) {
    const repo = out[repoName]
    const wrapped = { ...repo }
    for (const method of methods as readonly string[]) {
      const call = repo?.[method]
      // Inalcanzable con el tipo puesto; llega hasta acá solo si alguien forzó las deps con un
      // cast. Revienta en vez de seguir sin memoizar: una degradación silenciosa es justo lo que
      // este archivo no puede permitirse.
      if (typeof call !== "function")
        throw new TypeError(
          `request-memo: falta ${repoName}.${method} en las deps recibidas.`
        )
      const read = call as (...args: unknown[]) => Promise<unknown>
      wrapped[method] = (...args: unknown[]): Promise<unknown> => {
        const store = scope()
        const key = `${repoName}.${method}(${JSON.stringify(args)})`
        const hit = store.get(key)
        if (hit) return hit
        const pending = read.apply(repo, args)
        store.set(key, pending)
        // Un rechazo no se queda pegado al ámbito. Sin esto, quien lea primero le impone su fallo
        // a todos los demás: el dashboard envuelve `getPreviousMonthDebt` en un `.catch` para que
        // un dato cosmético no tumbe la pantalla, y esa misma promesa rechazada llegaría a
        // `getBudgetView`, que no tiene catch. Al desalojarla, el siguiente lector reintenta y
        // recupera el aislamiento que había antes de memoizar.
        void pending.catch(() => {
          if (store.get(key) === pending) store.delete(key)
        })
        return pending
      }
    }
    out[repoName] = wrapped
  }
  return out as unknown as T
}
