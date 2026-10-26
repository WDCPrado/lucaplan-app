// Adapter Postgres del port IncomeRepository. Mapea Prisma Decimal ↔ Money; el dominio no ve Prisma.
// "generar" crea una Transaction credit vinculada a la fuente (incomeId), idempotente por (income, mes)
// vía check-then-insert dentro de una $transaction, ajustando el saldo de la cuenta destino.
import { prisma } from "./client.ts"
import type { PeriodRange } from "../../../shared/billing-cycle.ts"
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
function periodWhere(year: number, month: number, range?: PeriodRange) {
  const start = range ? new Date(range.start + "T00:00:00Z") : new Date(Date.UTC(year, month - 1, 1))
  const end = range ? new Date(Date.parse(range.end + "T00:00:00Z") + 86400000) : new Date(Date.UTC(year, month, 1))
  return { transactionDate: { gte: start, lt: end } }
}

// El cobro nominal del mes de cierre puede ocurrir en el mes calendario anterior.
// Ejemplo: ciclo 23/oct–20/nov, día 25 => 25/oct, nunca 25/nov.
function incomeDateInRange(year: number, month: number, day: number, range?: PeriodRange): Date {
  if (!range) return incomeDate(year, month, day)
  const begin = new Date(range.start + "T00:00:00Z")
  for (let offset = 0; offset < 3; offset++) {
    const candidate = incomeDate(begin.getUTCFullYear(), begin.getUTCMonth() + 1 + offset, day)
    if (candidate >= begin && candidate <= new Date(range.end + "T00:00:00Z")) return candidate
  }
  throw new Error("El día del ingreso no cae dentro del ciclo seleccionado")
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
  async hasGeneratedFor(incomeId, year, month, range) {
    const count = await prisma.transaction.count({
      where: { incomeId, ...periodWhere(year, month, range) },
    })
    return count > 0
  },
  async generateMonthly(income, year, month, range) {
    return prisma.$transaction(async (db) => {
      const existing = await db.transaction.findFirst({
        where: { incomeId: income.id, ...periodWhere(year, month, range) },
      })
      if (existing)
        return {
          transactionId: existing.id,
          created: false,
          amount: Money.of(
            existing.amount.toString(),
            existing.currency as CurrencyCode
          ),
        }

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
          transactionDate: incomeDateInRange(year, month, income.dayOfMonth, range),
          description: income.name,
          amount: monthAmount.toDecimalString(),
          currency: income.currency,
          direction: "credit",
        },
      })
      return { transactionId: row.id, created: true, amount: monthAmount }
    })
  },
  async ungenerateMonthly(incomeId, year, month, range) {
    return prisma.$transaction(async (db) => {
      const tx = await db.transaction.findFirst({
        where: { incomeId, ...periodWhere(year, month, range) },
      })
      if (!tx) return { deleted: false }

      // Un abono externo vinculado a una fuente no fue generado por esta función. Nunca borrarlo ni modificar caja.
      if (tx.externalId) {
        await db.transaction.update({ where: { id: tx.id }, data: { incomeId: null } })
        return { deleted: false }
      }
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
      return {
        deleted: true,
        amount: Money.of(tx.amount.toString(), tx.currency as CurrencyCode),
        accountId: tx.accountId,
      }
    })
  },
}
