// Memoización de lecturas por request, para el punto donde se bindean los adapters. No cambia
// ninguna firma de use-case ni toca el dominio: envuelve los métodos de lectura del objeto de
// deps, así que quien los llama no se entera.
//
// El problema que resuelve: una misma carga arma varias vistas (resumen, presupuesto, movimientos,
// ingresos) y cada una pide por su cuenta las categorías, sus límites, los presupuestos y demás.
// Son datos del usuario que no dependen de la vista, así que la segunda lectura idéntica es la
// misma consulta otra vez. Con `getPreviousMonthDebt` leyendo además el mes anterior con la misma
// vista, se duplican todas menos la de movimientos del período.

export type MemoStore = Map<string, Promise<unknown>>

// Lecturas de solo lectura, por usuario, que un mismo request pide idénticas más de una vez.
//
// NO están acá a propósito: `transactions.searchByUser` y `transactions.amountBounds` (se llaman
// una sola vez por carga), `incomes.hasGeneratedFor` (un argumento distinto por ingreso, no hay
// repetición que ahorrar) y `recurring.listActiveByUser` (la usa la materialización de períodos,
// que escribe). Memoizar una lectura que acompaña a una escritura es lo único que podría servir
// datos viejos, y ninguna de las de acá lo hace.
const READS: Record<string, readonly string[]> = {
  accounts: ["listByUser"],
  banks: ["listByUser"],
  balanceBuckets: ["listByUser"],
  categories: ["listByUser", "listLimitsByUser"],
  monthlyBudgets: ["listByUser"],
  transactions: ["listByUserPeriod"],
  incomes: ["listByUser", "listAmountsByUser"],
  installments: ["listByUser"],
  recurring: ["listByUser"],
}

/**
 * Devuelve `deps` con esas lecturas memoizadas: dentro de un mismo ámbito, la misma llamada con los
 * mismos argumentos golpea la base UNA vez y las demás reciben esa misma promesa.
 *
 * `scope` entrega el almacén del request en curso. Si devuelve uno nuevo en cada llamada —fuera de
 * un render de servidor: Route Handlers, scripts, cron— no memoiza nada y el comportamiento es el
 * de siempre. Esa degradación es la red de seguridad: lo que escribe nunca lee de la memoria.
 *
 * ponytail: la clave es el nombre del método más `JSON.stringify` de los argumentos. Alcanza porque
 * todos los argumentos de estas lecturas son strings y números. Si alguna pasara a recibir un
 * objeto con orden de claves variable, habría que darle una clave propia.
 */
export function memoizeReads<T extends object>(
  deps: T,
  scope: () => MemoStore
): T {
  const out = { ...deps } as Record<string, unknown>
  for (const [repoName, methods] of Object.entries(READS)) {
    const repo = out[repoName] as Record<string, unknown> | undefined
    if (!repo) continue
    const wrapped = { ...repo }
    for (const method of methods) {
      const read = repo[method]
      if (typeof read !== "function") continue
      const call = read as (...args: unknown[]) => Promise<unknown>
      wrapped[method] = (...args: unknown[]): Promise<unknown> => {
        const store = scope()
        const key = `${repoName}.${method}(${JSON.stringify(args)})`
        const hit = store.get(key)
        if (hit) return hit
        const pending = call.apply(repo, args)
        store.set(key, pending)
        return pending
      }
    }
    out[repoName] = wrapped
  }
  return out as T
}
