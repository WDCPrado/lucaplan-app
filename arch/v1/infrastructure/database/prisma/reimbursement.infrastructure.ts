import { prisma } from "./client.ts"
import type { Prisma } from "./generated/client.ts"
import { PluginReferenceError, PluginRejection } from "../../../application/plugin-use-cases/plugin-tools.ts"
import { currentBudgetPeriod } from "../../../application/finance-use-cases/budget-period-use-cases.ts"
import { budgetPeriodSettings } from "./budget-period.infrastructure.ts"

/** Serializable retries re-read both capacities and the unique pair after a racing commit. */
export async function reimbursementTransaction<T>(work: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: "Serializable" })
    } catch (error) {
      const code = (error as { code?: string }).code
      if (attempt >= 4 || (code !== "P2034" && code !== "P2002")) throw error
    }
  }
}

export async function linkReimbursement(userId: string, input: { expenseId: string; creditId: string; amount: number }) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
    throw new PluginRejection("El reembolso debe ser un importe positivo entero en CLP")
  return reimbursementTransaction(async db => {
    // Serialize against ordinary transaction edits/deletes too (those may use ReadCommitted).
    // Stable order avoids deadlocks when two links share a credit or an expense.
    await db.$queryRaw`SELECT id FROM "transaction"
      WHERE "userId" = ${userId} AND id IN (${input.expenseId}, ${input.creditId})
      ORDER BY id FOR UPDATE`
    const [expense, credit] = await Promise.all([
      db.transaction.findFirst({ where: { id: input.expenseId, userId } }),
      db.transaction.findFirst({ where: { id: input.creditId, userId } }),
    ])
    if (!expense || !credit) throw new PluginReferenceError(!expense ? "expenseId" : "creditId")
    if (expense.direction !== "debit" || credit.direction !== "credit" ||
        expense.status !== "confirmed" || credit.status !== "confirmed" ||
        expense.isInternal || credit.isInternal || expense.currency !== "CLP" || credit.currency !== "CLP")
      throw new PluginRejection("Se requiere gasto y abono confirmados no internos en CLP")
    const current = await db.expenseReimbursement.findUnique({
      where: { expenseId_creditId: { expenseId: expense.id, creditId: credit.id } },
      include: { budgetEffects: true },
    })
    if (current) {
      if (Number(current.amount) !== input.amount) throw new PluginRejection("Vínculo existente con otro importe")
      return { reimbursementId: current.id, amount: input.amount, created: false,
        budgetAdjustment: { applied: false, alreadyApplied: current.budgetEffects.some(e => e.treatment === "automatic"),
          effects: current.budgetEffects, legacy: current.budgetEffects.length === 0 } }
    }
    if (expense.categoryId) await db.$queryRaw`SELECT id FROM category
      WHERE id = ${expense.categoryId} AND "userId" = ${userId} FOR UPDATE`
    const category = expense.categoryId
      ? await db.category.findFirst({ where: { id: expense.categoryId, userId, type: "expense", isActive: true } })
      : null
    if (!category) throw new PluginRejection("Asigna primero una categoría de gasto activa a la compra; no se creó el reembolso")
    const [expenseLinks, creditLinks] = await Promise.all([
      db.expenseReimbursement.aggregate({ where: { expenseId: expense.id }, _sum: { amount: true } }),
      db.expenseReimbursement.aggregate({ where: { creditId: credit.id }, _sum: { amount: true } }),
    ])
    if (Number(expenseLinks._sum.amount ?? 0) + input.amount > Number(expense.amount) ||
        Number(creditLinks._sum.amount ?? 0) + input.amount > Number(credit.amount))
      throw new PluginRejection("La compensación excede el saldo libre del gasto o abono")
    const settings = await budgetPeriodSettings(db)
    const { year, month } = await currentBudgetPeriod({ periodSettings: settings }, expense.transactionDate.toISOString().slice(0, 10))
    const effect = { mode: settings.mode, year, month, categoryId: category.id, treatment: "automatic" }
    const linked = await db.expenseReimbursement.create({ data: {
      userId, expenseId: expense.id, creditId: credit.id, amount: input.amount,
      budgetEffects: { create: effect },
    } })
    return { reimbursementId: linked.id, amount: input.amount, created: true,
      budgetAdjustment: { applied: true, alreadyApplied: false, amount: input.amount,
        ...effect, categoryName: category.name, legacy: false } }
  })
}

/** Opt-in histórico. Preview por defecto; no altera topes ni saldos ni vuelve a sumar dinero. */
export async function normalizeManualReimbursements(input: {
  userId: string; reimbursementIds: string[]; mode: "calendar" | "card_cycle"; apply?: boolean
}) {
  if (!input.reimbursementIds.length) throw new PluginRejection("Indica los vínculos exactos que ya ajustaste manualmente")
  return reimbursementTransaction(async db => {
    if (input.apply) {
      // Lock the expense before taking the snapshot used for the manual marker.
      const links = await db.expenseReimbursement.findMany({
        where: { id: { in: input.reimbursementIds }, userId: input.userId }, select: { expenseId: true },
      })
      for (const id of [...new Set(links.map(r => r.expenseId))].sort())
        await db.$queryRaw`SELECT id FROM "transaction" WHERE id = ${id} FOR UPDATE`
    }
    const rows = await db.expenseReimbursement.findMany({
      where: { id: { in: [...new Set(input.reimbursementIds)] }, userId: input.userId },
      include: { expense: { include: { category: true } }, budgetEffects: true },
    })
    if (rows.length !== new Set(input.reimbursementIds).size) throw new PluginReferenceError("reimbursementIds")
    const settings = { ...await budgetPeriodSettings(db), mode: input.mode }
    const changes = []
    for (const row of rows) {
      const current = row.budgetEffects.find(e => e.mode === input.mode)
      if (current?.treatment === "automatic") throw new PluginRejection("Un reembolso automático no se puede marcar como ajuste manual")
      if (!row.expense.category || row.expense.category.type !== "expense" || !row.expense.category.isActive)
        throw new PluginRejection("El gasto debe tener categoría de gasto activa")
      const { year, month } = await currentBudgetPeriod({ periodSettings: settings }, row.expense.transactionDate.toISOString().slice(0, 10))
      const effect = { reimbursementId: row.id, mode: input.mode, year, month, categoryId: row.expense.categoryId!, treatment: "manual" }
      changes.push({ ...effect, amount: Number(row.amount), alreadyNormalized: !!current, budgetIncrease: 0 })
      if (input.apply && !current) await db.reimbursementBudgetEffect.create({ data: effect })
    }
    return { applied: !!input.apply, changes }
  })
}
