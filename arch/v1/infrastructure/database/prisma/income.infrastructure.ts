// Adapter Postgres del port IncomeRepository. Mapea Prisma Decimal ↔ Money; el dominio no ve Prisma.
// "generar" crea una Transaction credit vinculada a la fuente (incomeId), idempotente por (income, mes)
// vía check-then-insert dentro de una $transaction, ajustando el saldo de la cuenta destino.
import { prisma } from "./client.ts"
import type { PeriodMode, PeriodRange } from "../../../../shared/billing-cycle.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import {
  IncomeNotFoundError,
  InvalidIncomeError,
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
    isActive: row.plans[0].isActive,
    endedYear: row.plans[0].endedYear ?? null,
    endedMonth: row.plans[0].endedMonth ?? null,
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
  mode: PeriodMode,
  year: number,
  month: number,
  amount: Money
) {
  await db.incomeAmount.upsert({
    where: { incomeId_mode_year_month: { incomeId, mode, year, month } },
    create: {
      incomeId,
      mode,
      year,
      month,
      amount: amount.toDecimalString(),
    },
    update: { amount: amount.toDecimalString() },
  })
}

export const incomeRepository: IncomeRepository = {
  async listAvailableSources(userId, mode) {
    return prisma.income.findMany({
      where: { userId, plans: { none: { mode } } },
      select: { id: true, userId: true, accountId: true, categoryId: true, name: true, currency: true, dayOfMonth: true },
      orderBy: { createdAt: "asc" },
    }).then(rows => rows.map(row => ({ ...row, currency: row.currency as CurrencyCode })))
  },
  async listAmountsByUser(userId, mode) {
    const rows = await prisma.incomeAmount.findMany({
      where: { income: { userId }, mode },
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
  async listByUser(userId, mode) {
    return (
      await prisma.income.findMany({
        where: { userId, plans: { some: { mode } } },
        include: { plans: { where: { mode } } },
        orderBy: { createdAt: "asc" },
      })
    ).map(toIncome)
  },
  async findById(id, mode) {
    const row = await prisma.income.findFirst({ where: { id, plans: { some: { mode } } }, include: { plans: { where: { mode } } } })
    return row ? toIncome(row) : null
  },
  async create(input) {
    return prisma.$transaction(async (db) => {
      if (input.sourceId) {
        await db.$queryRaw`SELECT id FROM income WHERE id = ${input.sourceId} FOR UPDATE`
        const source = await db.income.findFirst({ where: { id: input.sourceId, userId: input.userId, plans: { none: { mode: input.mode } } } })
        if (!source) throw new InvalidIncomeError("La fuente ya tiene un plan en este modo o no está disponible")
      }
      const row = input.sourceId ? await db.income.update({
        where: { id: input.sourceId },
        data: { plans: { create: { mode: input.mode } } },
        include: { plans: { where: { mode: input.mode } } },
      }) : await db.income.create({
        data: {
          userId: input.userId,
          accountId: input.accountId,
          categoryId: input.categoryId,
          name: input.name,
          currency: input.amount.currency,
          dayOfMonth: input.dayOfMonth,
          plans: { create: { mode: input.mode } },
        },
        include: { plans: { where: { mode: input.mode } } },
      })
      // El monto rige desde el mes en que se creó: hacia atrás la fuente no existía.
      await upsertAmount(db, row.id, input.mode, input.year, input.month, input.amount)
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
          plans: { update: { where: { incomeId_mode: { incomeId: input.id, mode: input.mode } }, data: { isActive: input.isActive } } },
        },
        include: { plans: { where: { mode: input.mode } } },
      })
      // Solo el mes que se está editando; los anteriores conservan su monto.
      await upsertAmount(db, row.id, input.mode, input.year, input.month, input.amount)
      return toIncome(row)
    })
  },
  async endFrom(id, year, month, mode) {
    await prisma.incomePlan.update({
      where: { incomeId_mode: { incomeId: id, mode } },
      data: { endedYear: year, endedMonth: month },
    })
  },
  async hasGeneratedFor(incomeId, year, month, range) {
    const count = await prisma.transaction.count({
      where: { incomeId, ...periodWhere(year, month, range) },
    })
    return count > 0
  },
  async generateMonthly(income, mode, year, month, range) {
    return prisma.$transaction(async (db) => {
      // Serializa ambos modos por fuente; un cobro real nunca depende del modo del plan.
      await db.$queryRaw`SELECT id FROM income WHERE id = ${income.id} FOR UPDATE`
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
          mode,
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
