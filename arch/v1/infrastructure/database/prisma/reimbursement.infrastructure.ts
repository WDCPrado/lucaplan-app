import { prisma } from "./client.ts"
import type { Prisma } from "./generated/client.ts"
import { PluginReferenceError, PluginRejection } from "../../../application/plugin-use-cases/plugin-tools.ts"
import { currentBudgetPeriod } from "../../../application/finance-use-cases/budget-period-use-cases.ts"
import { budgetPeriodSettings } from "./budget-period.infrastructure.ts"
import {
  CANDIDATES_DAYS_AFTER,
  CANDIDATES_DAYS_BEFORE,
  rankReimbursementCandidates,
} from "../../../application/finance-use-cases/reimbursement-candidates.ts"

// En centavos: en USD la suma en coma flotante no cuadra (10.10 + 20.20 ≠ 30.30).
const cents = (x: unknown) => Math.round(Number(x ?? 0) * 100)

/** Serializable retries re-read both capacities and the unique pair after a racing commit. */
export async function reimbursementTransaction<T>(work: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: "Serializable" })
    } catch (error) {
      const { code, message } = error as { code?: string; message?: string }
      // Un conflicto de serialización dentro de un $queryRaw llega como P2010 con SQLSTATE 40001.
      const conflict = code === "P2034" || code === "P2002" || (code === "P2010" && /40001/.test(message ?? ""))
      if (attempt >= 4 || !conflict) throw error
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
    if (cents(expenseLinks._sum.amount) + cents(input.amount) > cents(expense.amount) ||
        cents(creditLinks._sum.amount) + cents(input.amount) > cents(credit.amount))
      throw new PluginRejection("La compensación excede el saldo libre del gasto o abono")
    const settings = await budgetPeriodSettings(db)
    const { year, month } = await currentBudgetPeriod({ periodSettings: settings }, expense.transactionDate.toISOString().slice(0, 10))
    const effect = { mode: settings.mode, year, month, categoryId: category.id, treatment: "automatic" }
    const linked = await db.expenseReimbursement.create({ data: {
      userId, expenseId: expense.id, creditId: credit.id, amount: input.amount,
      budgetEffects: { create: effect },
    } })
    // Un abono cubierto entero por reembolsos deja de ser ingreso del plan (WDC-183); uno parcial sigue
    // siendo ingreso. Un reverso se queda reverso.
    if (credit.creditKind === "income" &&
        cents(creditLinks._sum.amount) + cents(input.amount) === cents(credit.amount))
      await db.transaction.update({ where: { id: credit.id, userId }, data: { creditKind: "reimbursement" } })
    return { reimbursementId: linked.id, amount: input.amount, created: true,
      budgetAdjustment: { applied: true, alreadyApplied: false, amount: input.amount,
        ...effect, categoryName: category.name, legacy: false } }
  })
}

/**
 * Deshace un vínculo (WDC-184). Sus efectos en el tope caen por cascada. Un abono que era reembolso
 * y ya no queda cubierto entero vuelve a ingreso del plan. `transactionId`: si viene, el vínculo
 * tiene que tocar ese movimiento (cualquiera de los dos lados).
 */
export async function unlinkReimbursement(userId: string, reimbursementId: string, transactionId?: string) {
  return reimbursementTransaction(async db => {
    const link = await db.expenseReimbursement.findFirst({ where: { id: reimbursementId, userId,
      ...(transactionId ? { OR: [{ expenseId: transactionId }, { creditId: transactionId }] } : {}) } })
    if (!link) throw new PluginReferenceError("reimbursementId")
    // Mismo orden de bloqueo que linkReimbursement.
    await db.$queryRaw`SELECT id FROM "transaction"
      WHERE "userId" = ${userId} AND id IN (${link.expenseId}, ${link.creditId})
      ORDER BY id FOR UPDATE`
    await db.expenseReimbursement.delete({ where: { id: link.id } })
    const credit = await db.transaction.findFirst({ where: { id: link.creditId, userId } })
    if (credit?.creditKind === "reimbursement") {
      const rest = await db.expenseReimbursement.aggregate({ where: { creditId: credit.id }, _sum: { amount: true } })
      if (cents(rest._sum.amount) !== cents(credit.amount))
        await db.transaction.update({ where: { id: credit.id, userId }, data: { creditKind: "income" } })
    }
    return { reimbursementId: link.id, amount: Number(link.amount) }
  })
}

/** Gastos que el abono puede devolver: la lectura; la regla y el orden en rankReimbursementCandidates. */
export async function listReimbursementCandidates(userId: string, creditId: string) {
  const credit = await prisma.transaction.findFirst({ where: { id: creditId, userId },
    include: { reimbursementsReceived: { select: { amount: true, expenseId: true } } } })
  if (!credit) throw new PluginReferenceError("creditId")
  if (credit.direction !== "credit" || credit.status !== "confirmed" || credit.isInternal ||
      credit.currency !== "CLP" || !["income", "reimbursement"].includes(credit.creditKind ?? ""))
    throw new PluginRejection("Solo un abono de ingreso o reembolso confirmado en CLP puede devolver un gasto")
  const creditFree = Number(credit.amount) - credit.reimbursementsReceived.reduce((s, r) => s + Number(r.amount), 0)
  const at = credit.transactionDate.getTime()
  const day = 86_400_000
  // ponytail: el saldo libre se calcula en memoria; la ventana de ~4 meses acota las filas.
  const rows = await prisma.transaction.findMany({
    where: {
      userId, direction: "debit", status: "confirmed", isInternal: false, currency: "CLP",
      transactionDate: { gte: new Date(at - CANDIDATES_DAYS_BEFORE * day), lte: new Date(at + CANDIDATES_DAYS_AFTER * day) },
      category: { userId, type: "expense", isActive: true },
      // Un par ya vinculado no admite otro vínculo: se corrige deshaciéndolo.
      id: { notIn: credit.reimbursementsReceived.map(r => r.expenseId) },
    },
    select: { id: true, transactionDate: true, description: true, amount: true,
      category: { select: { name: true } }, reimbursementsPaid: { select: { amount: true } } },
  })
  return {
    creditFree,
    candidates: rankReimbursementCandidates(credit.transactionDate.toISOString().slice(0, 10), creditFree,
      rows.map(r => ({ id: r.id, date: r.transactionDate.toISOString().slice(0, 10), description: r.description,
        amount: Number(r.amount), linked: r.reimbursementsPaid.reduce((s, x) => s + Number(x.amount), 0),
        categoryName: r.category?.name ?? "" }))),
  }
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
