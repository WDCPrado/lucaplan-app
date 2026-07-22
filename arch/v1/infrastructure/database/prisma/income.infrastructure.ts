// Adapter Postgres del port IncomeRepository. Mapea Prisma Decimal ↔ Money; el dominio no ve Prisma.
// "generar" crea una Transaction credit vinculada a la fuente (incomeId), idempotente por (income, mes)
// vía check-then-insert dentro de una $transaction, ajustando el saldo de la cuenta destino.
import { prisma } from "./client.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import {
  IncomeNotFoundError,
  type Income,
  type IncomeRepository,
} from "../../../domain/finance/income.domain.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toIncome(row: any): Income {
  const currency = row.currency as CurrencyCode
  return {
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    categoryId: row.categoryId,
    name: row.name,
    currency,
    dayOfMonth: row.dayOfMonth,
    isActive: row.isActive,
    endedYear: row.endedYear ?? null,
    endedMonth: row.endedMonth ?? null,
  }
}

// Filtro [primer día del mes, primer día del mes siguiente) sobre transactionDate.
function periodWhere(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))
  return { transactionDate: { gte: start, lt: end } }
}

// Día efectivo del ingreso: el dayOfMonth de la fuente, recortado al último día del mes (ej. 31 → 28/29
// en febrero) para no desbordar al mes siguiente.
function incomeDate(year: number, month: number, dayOfMonth: number): Date {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return new Date(Date.UTC(year, month - 1, Math.min(dayOfMonth, lastDay)))
}

// El monto vive por mes (income_amount): un upsert por (fuente, año, mes). Editar el ingreso de
// agosto no toca los registros de meses anteriores.
async function upsertAmount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  incomeId: string,
  year: number,
  month: number,
  amount: Money
) {
  await db.incomeAmount.upsert({
    where: { incomeId_year_month: { incomeId, year, month } },
    create: {
      incomeId,
      year,
      month,
      amount: amount.toDecimalString(),
    },
    update: { amount: amount.toDecimalString() },
  })
}

export const incomeRepository: IncomeRepository = {
  async listAmountsByUser(userId) {
    const rows = await prisma.incomeAmount.findMany({
      where: { income: { userId } },
      include: { income: { select: { currency: true } } },
    })
    return rows.map((r) => ({
      incomeId: r.incomeId,
      year: r.year,
      month: r.month,
      amount: Money.of(
        r.amount.toString(),
        r.income.currency as CurrencyCode
      ),
    }))
  },
  async listByUser(userId) {
    return (
      await prisma.income.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      })
    ).map(toIncome)
  },
  async findById(id) {
    const row = await prisma.income.findUnique({ where: { id } })
    return row ? toIncome(row) : null
  },
  async create(input) {
    return prisma.$transaction(async (db) => {
      const row = await db.income.create({
        data: {
          userId: input.userId,
          accountId: input.accountId,
          categoryId: input.categoryId,
          name: input.name,
          currency: input.amount.currency,
          dayOfMonth: input.dayOfMonth,
        },
      })
      // El monto rige desde el mes en que se creó: hacia atrás la fuente no existía.
      await upsertAmount(db, row.id, input.year, input.month, input.amount)
      return toIncome(row)
    })
  },
  async update(input) {
    return prisma.$transaction(async (db) => {
      const row = await db.income.update({
        where: { id: input.id },
        data: {
          accountId: input.accountId,
          categoryId: input.categoryId,
          name: input.name,
          currency: input.amount.currency,
          dayOfMonth: input.dayOfMonth,
          isActive: input.isActive,
        },
      })
      // Solo el mes que se está editando; los anteriores conservan su monto.
      await upsertAmount(db, row.id, input.year, input.month, input.amount)
      return toIncome(row)
    })
  },
  async delete(id) {
    await prisma.income.delete({ where: { id } })
  },
  async endFrom(id, year, month) {
    await prisma.income.update({
      where: { id },
      data: { endedYear: year, endedMonth: month },
    })
  },
  async hasGeneratedFor(incomeId, year, month) {
    const count = await prisma.transaction.count({
      where: { incomeId, ...periodWhere(year, month) },
    })
    return count > 0
  },
  async generateMonthly(income, year, month) {
    return prisma.$transaction(async (db) => {
      const existing = await db.transaction.findFirst({
        where: { incomeId: income.id, ...periodWhere(year, month) },
      })
      if (existing) return { transactionId: existing.id, created: false }

      // Monto vigente en ESE mes (carry-forward): el registro del mes o el último previo.
      const amountRow = await db.incomeAmount.findFirst({
        where: {
          incomeId: income.id,
          OR: [{ year: { lt: year } }, { year, month: { lte: month } }],
        },
        orderBy: [{ year: "desc" }, { month: "desc" }],
      })
      if (!amountRow) throw new IncomeNotFoundError(income.id)
      const monthAmount = Money.of(
        amountRow.amount.toString(),
        income.currency as CurrencyCode
      )

      // Ingreso = credit: suma al saldo de la cuenta destino.
      const account = await db.financialAccount.findUniqueOrThrow({
        where: { id: income.accountId },
      })
      const newBalance = Money.of(
        account.balance.toString(),
        account.currency as CurrencyCode
      ).add(monthAmount)
      await db.financialAccount.update({
        where: { id: income.accountId },
        data: { balance: newBalance.toDecimalString() },
      })

      const row = await db.transaction.create({
        data: {
          userId: income.userId,
          accountId: income.accountId,
          categoryId: income.categoryId,
          incomeId: income.id,
          transactionDate: incomeDate(year, month, income.dayOfMonth),
          description: income.name,
          amount: monthAmount.toDecimalString(),
          currency: income.currency,
          direction: "credit",
        },
      })
      return { transactionId: row.id, created: true }
    })
  },
  async ungenerateMonthly(incomeId, year, month) {
    return prisma.$transaction(async (db) => {
      const tx = await db.transaction.findFirst({
        where: { incomeId, ...periodWhere(year, month) },
      })
      if (!tx) return { deleted: false }

      // Revierte el credit: resta del saldo el monto REAL del movimiento (la fuente pudo cambiar).
      const account = await db.financialAccount.findUniqueOrThrow({
        where: { id: tx.accountId },
      })
      const newBalance = Money.of(
        account.balance.toString(),
        account.currency as CurrencyCode
      ).subtract(Money.of(tx.amount.toString(), tx.currency as CurrencyCode))
      await db.financialAccount.update({
        where: { id: tx.accountId },
        data: { balance: newBalance.toDecimalString() },
      })
      await db.transaction.delete({ where: { id: tx.id } })
      return { deleted: true }
    })
  },
}
