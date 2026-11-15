// Adapter Postgres del port IncomeSourceRepository (WDC-185). Mapea Decimal ↔ Money y DATE ↔ YYYY-MM-DD.
// Cada escritura repite el userId en el where: un id ajeno no encuentra fila (P2025) en vez de escribir.
import { prisma } from "./client.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import type {
  IncomeSource,
  IncomeSourcePatch,
  IncomeSourceRepository,
} from "../../../domain/finance/income-source.domain.ts"

const day = (d: Date) => d.toISOString().slice(0, 10)
const date = (s: string) => new Date(`${s}T00:00:00.000Z`)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSource(row: any): IncomeSource {
  const currency = row.currency as CurrencyCode
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    categoryId: row.categoryId,
    currency,
    amount: Money.of(row.amount.toString(), currency),
    dayOfMonth: row.dayOfMonth,
    startsOn: day(row.startsOn),
    endsOn: row.endsOn ? day(row.endsOn) : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    amounts: (row.amounts ?? []).map((a: any) => ({
      month: `${a.year}-${String(a.month).padStart(2, "0")}`,
      amount: Money.of(a.amount.toString(), currency),
    })),
  }
}

const AMOUNTS = { amounts: { orderBy: [{ year: "asc" as const }, { month: "asc" as const }] } }
const ym = (month: string) => {
  const [year, m] = month.split("-").map(Number)
  return { year, month: m }
}

function toData(p: IncomeSourcePatch) {
  return {
    name: p.name,
    categoryId: p.categoryId,
    currency: p.currency,
    amount: p.amount?.toDecimalString(),
    dayOfMonth: p.dayOfMonth,
    startsOn: p.startsOn === undefined ? undefined : date(p.startsOn),
    endsOn: p.endsOn === undefined ? undefined : p.endsOn === null ? null : date(p.endsOn),
  }
}

export const incomeSourceRepository: IncomeSourceRepository = {
  async listByUser(userId) {
    return (
      await prisma.incomeSource.findMany({ where: { userId }, include: AMOUNTS, orderBy: [{ dayOfMonth: "asc" }, { createdAt: "asc" }] })
    ).map(toSource)
  },
  async findById(id) {
    const row = await prisma.incomeSource.findUnique({ where: { id }, include: AMOUNTS })
    return row ? toSource(row) : null
  },
  async create(input) {
    return toSource(
      await prisma.incomeSource.create({
        data: { ...toData(input), userId: input.userId } as Parameters<typeof prisma.incomeSource.create>[0]["data"],
        include: AMOUNTS,
      })
    )
  },
  async update(id, userId, patch) {
    return toSource(await prisma.incomeSource.update({ where: { id, userId }, data: toData(patch), include: AMOUNTS }))
  },
  async countLinked(id) {
    return prisma.transaction.count({ where: { incomeSourceId: id } })
  },
  async delete(id, userId) {
    await prisma.incomeSource.delete({ where: { id, userId } })
  },
  async setMonthAmount(id, userId, month, amount) {
    const key = { sourceId: id, ...ym(month) }
    // El dueño se comprueba en la misma consulta: un id ajeno no escribe nada.
    const owned = { source: { id, userId } }
    if (amount === null) {
      await prisma.incomeSourceAmount.deleteMany({ where: { ...key, ...owned } })
      return
    }
    await prisma.$transaction(async (db) => {
      await db.incomeSource.findUniqueOrThrow({ where: { id, userId }, select: { id: true } })
      await db.incomeSourceAmount.upsert({
        where: { sourceId_year_month: key },
        create: { ...key, amount: amount.toDecimalString() },
        update: { amount: amount.toDecimalString() },
      })
    })
  },
  async linkCredit(transactionId, userId, incomeSourceId) {
    // El where repite la regla del caso de uso: solo un abono propio de ingreso no interno.
    await prisma.transaction.update({
      where: { id: transactionId, userId, direction: "credit", isInternal: false, creditKind: "income" },
      data: { incomeSourceId },
    })
  },
}
