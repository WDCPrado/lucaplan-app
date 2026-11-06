// El tope global sigue al ingreso solo (WDC-178): una escritura que mueve el total del plan
// (ingreso − déficit del período anterior) lo aplica al tope del período en curso, como si la
// persona hubiera apretado «Igualar al ingreso». Solo si el tope estaba igualado (o sin definir):
// uno distinto lo puso alguien a mano y no se toca. Sin columna de origen: se deriva comparando.
import { PERIOD_MODES } from "../../domain/finance/budget-period.domain.ts"
import { planTotal } from "../../../../lib/plan-total.ts"
import { todayKey } from "../../../shared/today.ts"
import { currentBudgetPeriod, getBudgetPeriod, scopeBudgetPeriod } from "./budget-period-use-cases.ts"
import { getBudgetView, getPreviousMonthDebt } from "./finance-read.ts"
import { setMonthlyBudget } from "./set-monthly-budget-use-case.ts"

export type FollowIncomeDeps = Parameters<typeof getBudgetView>[0]

// Lo que muestra el toast del ingreso: si el tope cambió y a cuánto quedó (modo de la vista).
export type FollowIncomeSeed = { seeded: boolean; total: number }

async function snapshot(deps: FollowIncomeDeps, userId: string, today: string) {
  const { year, month } = await currentBudgetPeriod(deps, today)
  const [view, debt] = await Promise.all([
    getBudgetView(deps, userId, year, month),
    getPreviousMonthDebt(deps, userId, year, month),
  ])
  return { year, month, total: planTotal(view.income, debt), limit: view.globalLimit }
}

/**
 * Envuelve una escritura que cambia ingresos. `allModes`: la escritura toca movimientos, que
 * comparten los dos modos; el modo que no es el de `deps` solo sigue si ya tenía tope (no se le
 * crea uno a un modo que nadie usa). Las fuentes de ingreso son de un modo: sin `allModes`.
 * Un fallo del seguimiento no rompe la escritura, que ya quedó guardada: se registra y sigue.
 */
export async function followIncome<T>(
  deps: FollowIncomeDeps,
  userId: string,
  mutate: () => Promise<T>,
  opts: { allModes?: boolean; today?: string } = {}
): Promise<{ result: T; seed: FollowIncomeSeed | null }> {
  const today = opts.today ?? todayKey()
  let plans: FollowIncomeDeps[] = []
  let before: Awaited<ReturnType<typeof snapshot>>[] = []
  try {
    const { mode } = await getBudgetPeriod(deps)
    const modes = opts.allModes ? [mode, ...PERIOD_MODES.filter((m) => m !== mode)] : [mode]
    plans = await Promise.all(modes.map((m) => scopeBudgetPeriod(deps, m)))
    before = await Promise.all(plans.map((d) => snapshot(d, userId, today)))
  } catch (error) {
    console.error("followIncome: no se pudo leer el plan antes de escribir", error)
    return { result: await mutate(), seed: null }
  }

  const result = await mutate()

  try {
    let seed: FollowIncomeSeed | null = null
    for (const [i, d] of plans.entries()) {
      const prev = before[i]
      const next = await snapshot(d, userId, today)
      // Sin tope solo en el modo de la vista; con tope, solo si estaba igualado.
      const matched = prev.limit === null ? i === 0 : prev.limit === prev.total
      const seeded = matched && next.total !== prev.total && next.total > 0
      if (seeded)
        await setMonthlyBudget(d, userId, { year: prev.year, month: prev.month, globalLimit: next.total })
      if (i === 0) seed = { seeded, total: next.total }
    }
    return { result, seed }
  } catch (error) {
    console.error("followIncome: no se pudo ajustar el tope al ingreso", error)
    return { result, seed: null }
  }
}
