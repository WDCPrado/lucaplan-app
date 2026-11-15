// Ingresos programados (WDC-185): lo que se espera recibir cada mes. Son la base del plan: el
// esperado cuenta hasta que llega su abono vinculado (ver `planIncome`). Nunca crean movimientos.
// Toda escritura mueve el ingreso del plan, así que pasa por `followIncome` en los dos modos.
import {
  AccountNotFoundError,
  CategoryNotFoundError,
  NotOwnerError,
} from "../../domain/finance/finance.domain.ts"
import {
  IncomeSourceNotFoundError,
  InvalidIncomeSourceError,
  type IncomeSource,
  type IncomeSourcePatch,
  type IncomeSourceRepository,
} from "../../domain/finance/income-source.domain.ts"
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"
import type {
  CreateIncomeSourceInput,
  UpdateIncomeSourceInput,
} from "../../../../lib/schemas/income-source.ts"
import { todayKey } from "../../../shared/today.ts"
import { currentBudgetPeriod, rangeOf, scopeBudgetPeriod } from "./budget-period-use-cases.ts"
import { planIncome } from "./budget-formulas.ts"
import { followIncome, type FollowIncomeDeps } from "./follow-income.ts"

export type IncomeSourceDeps = FollowIncomeDeps & { incomeSources: IncomeSourceRepository }

export type IncomeSourcePeriodDTO = {
  expected: number // Σ esperado de sus ocurrencias en el período (0 = no le toca)
  received: number // Σ abonos vinculados que el plan le cuenta en el período
  pending: number // lo esperado que aún no llega (0 si ya llegó algo)
  status: "received" | "pending" | "none"
  credits: { id: string; date: string; description: string; amount: number }[]
}

export type IncomeSourceDTO = {
  id: string
  name: string
  categoryId: string
  categoryName: string
  currency: CurrencyCode
  amount: number // monto base por ocurrencia
  dayOfMonth: number
  startsOn: string
  endsOn: string | null
  amounts: { month: string; amount: number }[] // meses con monto propio, YYYY-MM
  period: IncomeSourcePeriodDTO
}

type Opts = { today?: string }

/** Programados del usuario con su estado en el período del plan (por defecto el actual del modo activo). */
export async function listIncomeSources(
  deps: IncomeSourceDeps,
  userId: string,
  period: { year?: number; month?: number } = {},
  opts: Opts = {}
): Promise<IncomeSourceDTO[]> {
  return toDTOs(deps, userId, await deps.incomeSources.listByUser(userId), period, opts)
}

async function toDTOs(
  deps: IncomeSourceDeps,
  userId: string,
  sources: IncomeSource[],
  period: { year?: number; month?: number },
  opts: Opts
): Promise<IncomeSourceDTO[]> {
  const scoped = await scopeBudgetPeriod(deps)
  const current = await currentBudgetPeriod(scoped, opts.today ?? todayKey())
  const year = period.year ?? current.year
  const month = period.month ?? current.month
  const range = await rangeOf(scoped, year, month)
  const [txs, categories] = await Promise.all([
    deps.transactions.listByUserPeriod(userId, range),
    deps.categories.listByUser(userId),
  ])
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const breakdown = new Map(
    (["CLP", "USD"] as const).flatMap((c) =>
      planIncome(txs, range, c, sources).sources.map((s) => [s.source.id, s] as const)
    )
  )
  return sources.map((s) => {
    const b = breakdown.get(s.id)
    const expected = b?.expected.toMajor() ?? 0
    const received = b?.received.toMajor() ?? 0
    return {
      id: s.id,
      name: s.name,
      categoryId: s.categoryId,
      categoryName: categoryName.get(s.categoryId) ?? "",
      currency: s.currency,
      amount: s.amount.toMajor(),
      dayOfMonth: s.dayOfMonth,
      startsOn: s.startsOn,
      endsOn: s.endsOn,
      amounts: s.amounts.map((a) => ({ month: a.month, amount: a.amount.toMajor() })),
      period: {
        expected,
        received,
        pending: received > 0 ? 0 : expected,
        status: received > 0 ? "received" : expected > 0 ? "pending" : "none",
        credits: (b?.credits ?? [])
          .map((t) => ({
            id: t.id,
            date: t.date.toISOString().slice(0, 10),
            description: t.description,
            amount: t.amount.toMajor(),
          }))
          .sort((x, y) => x.date.localeCompare(y.date)),
      },
    }
  })
}

// Monto en su moneda sin redondeo silencioso: CLP en pesos enteros, USD con 2 decimales.
function money(amount: number, currency: CurrencyCode): Money {
  const m = Money.of(amount, currency)
  if (m.toMajor() !== amount)
    throw new InvalidIncomeSourceError(
      currency === "CLP" ? "El monto en CLP va en pesos enteros" : "El monto en USD lleva hasta 2 decimales"
    )
  return m
}

async function assertIncomeCategory(deps: IncomeSourceDeps, userId: string, categoryId: string) {
  const category = (await deps.categories.listByUser(userId)).find((c) => c.id === categoryId)
  if (!category) throw new CategoryNotFoundError(categoryId)
  if (category.type !== "income") throw new InvalidIncomeSourceError("La categoría debe ser de ingreso")
}

async function owned(deps: IncomeSourceDeps, userId: string, id: string): Promise<IncomeSource> {
  const source = await deps.incomeSources.findById(id)
  if (!source || source.userId !== userId) throw new IncomeSourceNotFoundError(id)
  return source
}

async function saveAmounts(
  deps: IncomeSourceDeps,
  userId: string,
  id: string,
  currency: CurrencyCode,
  amounts: { month: string; amount: number }[] = []
) {
  for (const a of amounts) await deps.incomeSources.setMonthAmount(id, userId, a.month, money(a.amount, currency))
}

export async function createIncomeSource(
  deps: IncomeSourceDeps,
  userId: string,
  input: CreateIncomeSourceInput,
  opts: Opts = {}
): Promise<IncomeSourceDTO> {
  await assertIncomeCategory(deps, userId, input.categoryId)
  const amount = money(input.amount, input.currency)
  for (const a of input.amounts ?? []) money(a.amount, input.currency)
  const { result } = await followIncome(
    deps,
    userId,
    async () => {
      const created = await deps.incomeSources.create({
        userId,
        name: input.name,
        categoryId: input.categoryId,
        currency: input.currency,
        amount,
        dayOfMonth: input.dayOfMonth,
        startsOn: input.startsOn,
        endsOn: input.endsOn ?? null,
      })
      await saveAmounts(deps, userId, created.id, created.currency, input.amounts)
      return created.id
    },
    { allModes: true, today: opts.today }
  )
  return (await toDTOs(deps, userId, [await owned(deps, userId, result)], {}, opts))[0]
}

export async function updateIncomeSource(
  deps: IncomeSourceDeps,
  userId: string,
  id: string,
  input: UpdateIncomeSourceInput,
  opts: Opts = {}
): Promise<IncomeSourceDTO> {
  const source = await owned(deps, userId, id)
  const currency = input.currency ?? source.currency
  if (input.categoryId !== undefined) await assertIncomeCategory(deps, userId, input.categoryId)
  if (currency !== source.currency) {
    // Los abonos vinculados y los montos por mes están en la moneda vieja: no se reinterpretan.
    if ((await deps.incomeSources.countLinked(id)) > 0 || source.amounts.length > 0)
      throw new InvalidIncomeSourceError("Tiene abonos o montos por mes en su moneda: no puede cambiarla")
    if (input.amount === undefined) throw new InvalidIncomeSourceError("Al cambiar la moneda, indica el monto")
  }
  const startsOn = input.startsOn ?? source.startsOn
  const endsOn = input.endsOn === undefined ? source.endsOn : input.endsOn
  if (endsOn !== null && endsOn < startsOn)
    throw new InvalidIncomeSourceError("«Hasta» no puede ser antes de «Desde»")
  const patch: IncomeSourcePatch = {
    name: input.name,
    categoryId: input.categoryId,
    currency: input.currency,
    amount: input.amount === undefined ? undefined : money(input.amount, currency),
    dayOfMonth: input.dayOfMonth,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
  }
  for (const a of input.amounts ?? []) money(a.amount, currency)
  await followIncome(
    deps,
    userId,
    async () => {
      await deps.incomeSources.update(id, userId, patch)
      await saveAmounts(deps, userId, id, currency, input.amounts)
    },
    { allModes: true, today: opts.today }
  )
  return (await toDTOs(deps, userId, [await owned(deps, userId, id)], {}, opts))[0]
}

/**
 * Con abonos vinculados no se borra (perdería de qué programado vino cada abono): termina su vigencia
 * hoy. Sin vínculos, se borra.
 */
export async function deleteIncomeSource(
  deps: IncomeSourceDeps,
  userId: string,
  id: string,
  opts: Opts = {}
): Promise<{ ended: true } | { deleted: true }> {
  await owned(deps, userId, id)
  const today = opts.today ?? todayKey()
  const { result } = await followIncome(
    deps,
    userId,
    async (): Promise<{ ended: true } | { deleted: true }> => {
      if ((await deps.incomeSources.countLinked(id)) > 0) {
        await deps.incomeSources.update(id, userId, { endsOn: today })
        return { ended: true }
      }
      await deps.incomeSources.delete(id, userId)
      return { deleted: true }
    },
    { allModes: true, today }
  )
  return result
}

/** Fija (amount) o quita (null) el monto de un mes calendario YYYY-MM. */
export async function setIncomeSourceMonthAmount(
  deps: IncomeSourceDeps,
  userId: string,
  id: string,
  month: string,
  amount: number | null,
  opts: Opts = {}
): Promise<IncomeSourceDTO> {
  const source = await owned(deps, userId, id)
  const value = amount === null ? null : money(amount, source.currency)
  await followIncome(deps, userId, () => deps.incomeSources.setMonthAmount(id, userId, month, value), {
    allModes: true,
    today: opts.today,
  })
  return (await toDTOs(deps, userId, [await owned(deps, userId, id)], {}, opts))[0]
}

/**
 * Valida que un abono pueda vincularse a un programado: abono de ingreso propio, no interno, y
 * programado propio en la misma moneda (la conciliación repite la regla en planBankReconciliation).
 */
function assertLinkable(
  tx: { direction: string; isInternal: boolean; creditKind?: string | null; amount: Money },
  source: IncomeSource
) {
  if (tx.direction !== "credit" || tx.isInternal || tx.creditKind !== "income")
    throw new InvalidIncomeSourceError("Solo un abono de ingreso puede vincularse a un ingreso programado")
  if (tx.amount.currency !== source.currency)
    throw new InvalidIncomeSourceError(
      `El abono es en ${tx.amount.currency} y el ingreso programado en ${source.currency}`
    )
}

/** Vincula un abono de ingreso a un programado del usuario, o lo desvincula con null. */
export async function linkCreditToIncomeSource(
  deps: IncomeSourceDeps,
  userId: string,
  transactionId: string,
  incomeSourceId: string | null,
  opts: Opts = {}
): Promise<{ id: string; incomeSourceId: string | null }> {
  const tx = await deps.transactions.findById(transactionId)
  if (!tx) throw new AccountNotFoundError(transactionId)
  if (tx.userId !== userId) throw new NotOwnerError()
  if (incomeSourceId !== null) assertLinkable(tx, await owned(deps, userId, incomeSourceId))
  else if (tx.direction !== "credit" || tx.isInternal || tx.creditKind !== "income")
    throw new InvalidIncomeSourceError("Solo un abono de ingreso puede vincularse a un ingreso programado")
  if ((tx.incomeSourceId ?? null) === incomeSourceId) return { id: tx.id, incomeSourceId }
  await followIncome(deps, userId, () => deps.incomeSources.linkCredit(tx.id, userId, incomeSourceId), {
    allModes: true,
    today: opts.today,
  })
  return { id: tx.id, incomeSourceId }
}
