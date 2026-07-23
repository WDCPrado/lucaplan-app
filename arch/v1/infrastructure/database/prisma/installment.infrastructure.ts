// Adapter Postgres del port InstallmentPlanRepository. Mapea Prisma Decimal ↔ Money; el dominio no
// ve Prisma. La idempotencia de una cuota la impone el índice único `Transaction.installmentItemId`
// —no una comprobación previa sujeta a carrera—: por eso escribir sobre un ítem ya saldado devuelve
// `false` en vez de crear un segundo movimiento.
import { prisma } from "./client.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import type {
  InstallmentKind,
  InstallmentPlan,
  InstallmentPlanRepository,
} from "../../../domain/finance/installment.domain.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPlan(row: any): InstallmentPlan {
  const currency = row.currency as CurrencyCode
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as InstallmentKind,
    accountId: row.accountId,
    categoryId: row.categoryId,
    sourceTransactionId: row.sourceTransactionId ?? null,
    description: row.description,
    totalAmount: Money.of(row.totalAmount.toString(), currency),
    currency,
    installmentsCount: row.installmentsCount,
    startDate: row.startDate,
    dayOfMonth: row.dayOfMonth,
    tolerancePct: row.tolerancePct,
    completedAt: row.completedAt ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: (row.items ?? []).map((i: any) => ({
      id: i.id,
      index: i.index,
      dueDate: i.dueDate,
      amount: Money.of(i.amount.toString(), currency),
      transactionId: i.transaction?.id ?? null,
      paidOutsideApp: i.paidOutsideApp,
    })),
  }
}

const withItems = {
  items: {
    orderBy: { index: "asc" },
    include: { transaction: { select: { id: true } } },
  },
} as const

export const installmentPlanRepository: InstallmentPlanRepository = {
  async listByUser(userId) {
    return (
      await prisma.installmentPlan.findMany({
        where: { userId },
        include: withItems,
        orderBy: { createdAt: "desc" },
      })
    ).map(toPlan)
  },
  async listActiveByAccount(accountId, kind) {
    return (
      await prisma.installmentPlan.findMany({
        where: { accountId, kind, completedAt: null },
        include: withItems,
        orderBy: { createdAt: "asc" },
      })
    ).map(toPlan)
  },
  async findById(id) {
    const row = await prisma.installmentPlan.findUnique({
      where: { id },
      include: withItems,
    })
    return row ? toPlan(row) : null
  },
  async findByTransaction(transactionId) {
    const row = await prisma.installmentPlan.findFirst({
      where: {
        OR: [
          { sourceTransactionId: transactionId },
          { items: { some: { transaction: { id: transactionId } } } },
        ],
      },
      include: withItems,
    })
    return row ? toPlan(row) : null
  },
  async create(input, items) {
    return toPlan(
      await prisma.installmentPlan.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          accountId: input.accountId,
          categoryId: input.categoryId,
          description: input.description,
          totalAmount: input.totalAmount.toDecimalString(),
          currency: input.totalAmount.currency,
          installmentsCount: input.installmentsCount,
          startDate: input.startDate,
          dayOfMonth: input.dayOfMonth,
          tolerancePct: input.tolerancePct,
          items: {
            create: items.map((i) => ({
              index: i.index,
              dueDate: i.dueDate,
              amount: i.amount.toDecimalString(),
            })),
          },
        },
        include: withItems,
      })
    )
  },
  async delete(id, restoreSourceTransactionId = null) {
    // Los movimientos de las cuotas ya ocurrieron: se conservan, solo pierden el vínculo. Borrar el
    // plan no puede borrar gasto real del historial. La compra origen se des-neutraliza solo cuando
    // el use-case lo pide (plan card sin cuotas registradas): si no, ese gasto desaparecería de los
    // cálculos para siempre.
    await prisma.$transaction(async (db) => {
      if (restoreSourceTransactionId)
        await db.transaction.update({
          where: { id: restoreSourceTransactionId },
          data: { isInternal: false },
        })
      await db.installmentPlan.delete({ where: { id } })
    })
  },
  async registerItemTransaction(plan, itemId, date, amount) {
    const item = await prisma.installmentItem.findUnique({
      where: { id: itemId },
      include: { transaction: { select: { id: true } } },
    })
    if (!item || item.transaction || item.paidOutsideApp) return false
    try {
      await prisma.transaction.create({
        data: {
          userId: plan.userId,
          accountId: plan.accountId,
          categoryId: plan.categoryId,
          installmentItemId: itemId,
          transactionDate: date,
          description: `${plan.description} · cuota ${item.index}/${plan.installmentsCount}`,
          amount: amount.toDecimalString(),
          currency: amount.currency,
          direction: "debit",
          status: "confirmed",
          reviewed: true, // ya tiene la categoría del plan: fuera del triage y de la IA
        },
      })
      return true
    } catch {
      // Carrera: el único de BD ya registró esta cuota. No se crea una segunda.
      return false
    }
  },
  async adoptTransaction(plan, itemId, transactionId) {
    return prisma.$transaction(async (db) => {
      const item = await db.installmentItem.findUnique({
        where: { id: itemId },
        include: { transaction: { select: { id: true } } },
      })
      if (!item || item.transaction || item.paidOutsideApp) return false
      // El movimiento conserva su monto, fecha y externalId reales —el correo es el hecho— y solo
      // adopta el vínculo y la categoría del plan.
      const { count } = await db.transaction.updateMany({
        where: { id: transactionId, installmentItemId: null },
        data: {
          categoryId: plan.categoryId,
          installmentItemId: itemId,
          reviewed: true,
        },
      })
      return count > 0
    })
  },
  async markPaidOutsideApp(itemIds) {
    await prisma.installmentItem.updateMany({
      where: { id: { in: itemIds } },
      data: { paidOutsideApp: true },
    })
  },
  async updateItems(updates) {
    // La cuota y su movimiento son la misma verdad: si ya está registrada, la edición viaja a las
    // dos filas. Todo el lote (cuota editada + pendientes redistribuidas) en una sola transacción.
    await prisma.$transaction(async (db) => {
      for (const u of updates) {
        const item = await db.installmentItem.update({
          where: { id: u.itemId },
          data: {
            amount: u.amount.toDecimalString(),
            ...(u.dueDate ? { dueDate: u.dueDate } : {}),
          },
          include: { transaction: { select: { id: true } } },
        })
        if (item.transaction)
          await db.transaction.update({
            where: { id: item.transaction.id },
            data: {
              amount: u.amount.toDecimalString(),
              ...(u.dueDate ? { transactionDate: u.dueDate } : {}),
            },
          })
      }
    })
  },
  async setCategory(planId, categoryId) {
    // La categoría es del PLAN: recategorizarlo arrastra todos sus movimientos —cuotas registradas
    // y compra origen— para que no queden dos verdades.
    await prisma.$transaction([
      prisma.installmentPlan.update({
        where: { id: planId },
        data: { categoryId },
      }),
      prisma.transaction.updateMany({
        where: {
          OR: [
            { installmentItem: { planId } },
            { installmentPlanAsSource: { id: planId } },
          ],
        },
        data: { categoryId },
      }),
    ])
  },
  async markCompleted(planId, at) {
    await prisma.installmentPlan.update({
      where: { id: planId },
      data: { completedAt: at },
    })
  },
  async reopen(planId) {
    await prisma.installmentPlan.update({
      where: { id: planId },
      data: { completedAt: null },
    })
  },
  async neutralizeSourceTransaction(planId, transactionId) {
    await prisma.$transaction(async (db) => {
      // isInternal ya excluye del presupuesto y de la caja: el total deja de contar sin lógica
      // nueva. Se conserva para ver cuánto cobró el banco.
      await db.transaction.update({
        where: { id: transactionId },
        data: { isInternal: true, reviewed: true },
      })
      await db.installmentPlan.update({
        where: { id: planId },
        data: { sourceTransactionId: transactionId },
      })
    })
  },
  async listLinkCandidates(userId, around, accountId) {
    // Ventana de ±45 días: un pago se busca por cercanía al vencimiento, no revisando el año.
    const window = 45 * 86_400_000
    const rows = await prisma.transaction.findMany({
      where: {
        userId,
        ...(accountId ? { accountId } : {}),
        installmentItemId: null,
        isInternal: false,
        direction: "debit",
        status: "confirmed",
        transactionDate: {
          gte: new Date(around.getTime() - window),
          lte: new Date(around.getTime() + window),
        },
      },
      select: {
        id: true,
        description: true,
        amount: true,
        currency: true,
        transactionDate: true,
        categoryId: true,
        account: { select: { name: true } },
      },
      take: 50,
    })
    return rows
      .map((r) => ({
        transactionId: r.id,
        description: r.description,
        amount: Money.of(r.amount.toString(), r.currency as CurrencyCode),
        date: r.transactionDate,
        accountName: r.account.name,
        categoryId: r.categoryId ?? null,
      }))
      .sort(
        (a, b) =>
          Math.abs(a.date.getTime() - around.getTime()) -
          Math.abs(b.date.getTime() - around.getTime())
      )
  },
  async unlinkTransaction(transactionId) {
    // Solo se suelta el vínculo: el movimiento es un gasto real y se conserva tal cual.
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { installmentItemId: null },
    })
  },
  async listUnclaimedLoanPayments(userId, accountId) {
    const rows = await prisma.transaction.findMany({
      where: {
        userId,
        accountId,
        installmentItemId: null,
        isInternal: false,
        direction: "debit",
        description: { contains: "crédito de consumo" },
      },
      select: {
        id: true,
        amount: true,
        currency: true,
        transactionDate: true,
        description: true,
      },
      orderBy: { transactionDate: "asc" },
    })
    return rows.map((r) => ({
      transactionId: r.id,
      accountId,
      amount: Money.of(r.amount.toString(), r.currency as CurrencyCode),
      date: r.transactionDate,
      installmentNumber: parseInstallmentNumber(r.description),
    }))
  },
}

// El importador escribe "Pago cuota N de crédito de consumo" cuando el correo trae el N° de cuota
// (ver bancochile-email-map). Recuperarlo de ahí evita agregar una columna para un dato que ya
// viaja en la descripción.
function parseInstallmentNumber(description: string): number | null {
  const m = description.match(/cuota\s+(\d{1,3})\b/i)
  return m ? Number(m[1]) : null
}
