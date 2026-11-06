// El tope global sigue al ingreso solo (WDC-178): tras una escritura que puede mover el total del
// plan (ingreso − déficit del período anterior), el tope del período en curso que sigue al
// ingreso queda igual a ese total, como si se hubiera apretado «Igualar al ingreso». Sigue el tope
// con la marca `followsIncome` (la pone Igualar, heredada como el tope) y el que no existe; uno
// escrito a mano no se toca.
import { PERIOD_MODES } from "../../domain/finance/budget-period.domain.ts"
import { Money } from "../../domain/finance/money.ts"
import { planTotal } from "../../../../lib/plan-total.ts"
import { todayKey } from "../../../shared/today.ts"
import { currentBudgetPeriod, getBudgetPeriod, scopeBudgetPeriod } from "./budget-period-use-cases.ts"
import { effectiveGlobalBudget } from "./budget-formulas.ts"
import { getBudgetView, getPreviousMonthDebt } from "./finance-read.ts"

export type FollowIncomeDeps = Parameters<typeof getBudgetView>[0]

// Lo que muestra el toast del ingreso: si el tope cambió y el tope vigente (modo de la vista).
export type FollowIncomeSeed = { seeded: boolean; total: number | null }

// Un modo: devuelve null si no corresponde seguir (otro modo sin tope).
async function followMode(
  deps: FollowIncomeDeps,
  userId: string,
  today: string,
  isViewMode: boolean
): Promise<FollowIncomeSeed | null> {
  const { mode } = await getBudgetPeriod(deps)
  const { year, month } = await currentBudgetPeriod(deps, today)
  const current = effectiveGlobalBudget(await deps.monthlyBudgets.listByUser(userId, mode), year, month)
  const limit = current ? current.globalLimit.toMajor() : null
  if (!current && !isViewMode) return null // no se le crea un tope a un modo que nadie usa
  if (current && !current.followsIncome) return { seeded: false, total: limit }
  const [view, debt] = await Promise.all([
    getBudgetView(deps, userId, year, month),
    getPreviousMonthDebt(deps, userId, year, month),
  ])
  const total = planTotal(view.income, debt)
  // Sin tope y sin ingreso no se crea un tope en 0; con la marca puesta, 0 sí se sigue.
  if (total === limit || (limit === null && total === 0)) return { seeded: false, total: limit }
  const seeded = await deps.monthlyBudgets.setFollowingIncome({
    mode, userId, year, month, globalLimit: Money.of(total, "CLP"),
  })
  return { seeded, total: seeded ? total : limit }
}

/**
 * Corre la escritura y después alinea el tope. `allModes`: la escritura toca movimientos, que
 * comparten los dos modos; las fuentes de ingreso son de un modo (sin `allModes`). Un fallo del
 * seguimiento no rompe la escritura, que ya quedó guardada: se registra y sigue.
 *
 * ponytail: sin lock. Dos escrituras concurrentes pueden dejar el total de la primera; la marca
 * sigue puesta, así que la próxima escritura que mueva ingresos lo corrige.
 */
export async function followIncome<T>(
  deps: FollowIncomeDeps,
  userId: string,
  mutate: () => Promise<T>,
  opts: { allModes?: boolean; today?: string } = {}
): Promise<{ result: T; seed: FollowIncomeSeed | null }> {
  const result = await mutate()
  return { result, seed: await alignGlobalLimit(deps, userId, opts) }
}

/** El seguimiento solo, para quien ya escribió (la sincronización por correo). Nunca lanza. */
export async function alignGlobalLimit(
  deps: FollowIncomeDeps,
  userId: string,
  opts: { allModes?: boolean; today?: string } = {}
): Promise<FollowIncomeSeed | null> {
  const today = opts.today ?? todayKey()
  let seed: FollowIncomeSeed | null = null
  try {
    const { mode } = await getBudgetPeriod(deps)
    const modes = opts.allModes ? [mode, ...PERIOD_MODES.filter((m) => m !== mode)] : [mode]
    for (const [i, m] of modes.entries()) {
      try {
        const out = await followMode(await scopeBudgetPeriod(deps, m), userId, today, i === 0)
        if (i === 0) seed = out
      } catch (error) {
        console.error(`followIncome: no se pudo ajustar el tope (${m})`, error)
      }
    }
  } catch (error) {
    console.error("followIncome: no se pudo leer el modo del plan", error)
  }
  return seed
}
