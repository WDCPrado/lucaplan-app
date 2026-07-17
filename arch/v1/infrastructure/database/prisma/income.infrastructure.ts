// Adapter Postgres del port IncomeRepository. Mapea Prisma Decimal ↔ Money; el dominio no ve Prisma.
// "generar" crea una Transaction credit vinculada a la fuente (incomeId), idempotente por (income, mes)
// vía check-then-insert dentro de una $transaction, ajustando el saldo de la cuenta destino.
import { prisma } from "./client.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import type {
  Income,
  IncomeRepository,
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
    amount: Money.of(row.amount.toString(), currency),
    currency,
    dayOfMonth: row.dayOfMonth,
    isActive: row.isActive,
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

export const incomeRepository: IncomeRepository = {
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
    const row = await prisma.income.create({
      data: {
        userId: input.userId,
        accountId: input.accountId,
        categoryId: input.categoryId,
        name: input.name,
        amount: input.amount.toDecimalString(),
        currency: input.amount.currency,
        dayOfMonth: input.dayOfMonth,
      },
    })
    return toIncome(row)
  },
  async update(input) {
    const row = await prisma.income.update({
      where: { id: input.id },
      data: {
        accountId: input.accountId,
        categoryId: input.categoryId,
        name: input.name,
        amount: input.amount.toDecimalString(),
        currency: input.amount.currency,
        dayOfMonth: input.dayOfMonth,
        isActive: input.isActive,
      },
    })
    return toIncome(row)
  },
  async delete(id) {
    await prisma.income.delete({ where: { id } })
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

      // Ingreso = credit: suma al saldo de la cuenta destino.
      const account = await db.financialAccount.findUniqueOrThrow({
        where: { id: income.accountId },
      })
      const newBalance = Money.of(
        account.balance.toString(),
        account.currency as CurrencyCode
      ).add(income.amount)
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
          amount: income.amount.toDecimalString(),
          currency: income.amount.currency,
          direction: "credit",
        },
      })
      return { transactionId: row.id, created: true }
    })
  },
}
