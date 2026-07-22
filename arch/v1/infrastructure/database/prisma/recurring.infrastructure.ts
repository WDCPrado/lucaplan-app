// Adapter Postgres del port RecurringTemplateRepository. Mapea Prisma Decimal ↔ Money; el dominio
// no ve Prisma. El comprometido del período es una Transaction `pending`: NO ajusta el saldo de la
// cuenta (no se ha cobrado). La idempotencia por (plantilla, período) la impone el índice único
// (recurringTemplateId, periodKey), no una comprobación previa sujeta a carrera.
import { prisma } from "./client.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import type { Direction } from "../../../domain/finance/finance.domain.ts"
import type {
  Periodicity,
  RecurringTemplate,
  RecurringTemplateRepository,
} from "../../../domain/finance/recurring.domain.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTemplate(row: any): RecurringTemplate {
  const currency = row.currency as CurrencyCode
  return {
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    categoryId: row.categoryId,
    description: row.description,
    direction: row.direction as Direction,
    baseAmount: Money.of(row.baseAmount.toString(), currency),
    currency,
    tolerancePct: row.tolerancePct,
    periodicity: row.periodicity as Periodicity,
    dayOfMonth: row.dayOfMonth,
    startDate: row.startDate,
    endDate: row.endDate ?? null,
    isActive: row.isActive,
  }
}

export const recurringTemplateRepository: RecurringTemplateRepository = {
  async listByUser(userId) {
    return (
      await prisma.recurringTemplate.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      })
    ).map(toTemplate)
  },
  async listActiveByUser(userId) {
    return (
      await prisma.recurringTemplate.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: "asc" },
      })
    ).map(toTemplate)
  },
  async listAllActive() {
    return (
      await prisma.recurringTemplate.findMany({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
      })
    ).map(toTemplate)
  },
  async findById(id) {
    const row = await prisma.recurringTemplate.findUnique({ where: { id } })
    return row ? toTemplate(row) : null
  },
  async create(input) {
    return toTemplate(
      await prisma.recurringTemplate.create({
        data: {
          userId: input.userId,
          accountId: input.accountId,
          categoryId: input.categoryId,
          description: input.description,
          direction: input.direction,
          baseAmount: input.baseAmount.toDecimalString(),
          currency: input.baseAmount.currency,
          tolerancePct: input.tolerancePct,
          periodicity: input.periodicity,
          dayOfMonth: input.dayOfMonth,
          startDate: input.startDate,
          endDate: input.endDate,
        },
      })
    )
  },
  async update(input) {
    return toTemplate(
      await prisma.recurringTemplate.update({
        where: { id: input.id },
        data: {
          accountId: input.accountId,
          categoryId: input.categoryId,
          description: input.description,
          direction: input.direction,
          baseAmount: input.baseAmount.toDecimalString(),
          currency: input.baseAmount.currency,
          tolerancePct: input.tolerancePct,
          periodicity: input.periodicity,
          dayOfMonth: input.dayOfMonth,
          startDate: input.startDate,
          endDate: input.endDate,
          isActive: input.isActive,
        },
      })
    )
  },
  async dropCommittedOutsideValidity(template) {
    // Solo lo comprometido: un movimiento confirmado es un cobro real, aunque hoy caiga fuera.
    const { count } = await prisma.transaction.deleteMany({
      where: {
        recurringTemplateId: template.id,
        status: "pending",
        OR: [
          { transactionDate: { lt: template.startDate } },
          ...(template.endDate
            ? [{ transactionDate: { gt: template.endDate } }]
            : []),
        ],
      },
    })
    return count
  },
  async delete(id) {
    await prisma.$transaction(async (db) => {
      // Lo confirmado se conserva sin vínculo (es historia real); lo comprometido se va con ella.
      await db.transaction.deleteMany({
        where: { recurringTemplateId: id, status: "pending" },
      })
      await db.transaction.updateMany({
        where: { recurringTemplateId: id },
        data: { recurringTemplateId: null, periodKey: null },
      })
      await db.recurringTemplate.delete({ where: { id } })
    })
  },
  async setCategory(templateId, categoryId) {
    await prisma.$transaction(async (db) => {
      await db.recurringTemplate.update({
        where: { id: templateId },
        data: { categoryId },
      })
      // Los comprometidos del período aún no cobrados siguen a la plantilla; lo confirmado no.
      await db.transaction.updateMany({
        where: { recurringTemplateId: templateId, status: "pending" },
        data: { categoryId },
      })
    })
  },
  async materializePeriod(template, periodKey, date) {
    const existing = await prisma.transaction.findFirst({
      where: { recurringTemplateId: template.id, periodKey },
    })
    if (existing) return { transactionId: existing.id, created: false }
    try {
      const row = await prisma.transaction.create({
        data: {
          userId: template.userId,
          accountId: template.accountId,
          categoryId: template.categoryId,
          recurringTemplateId: template.id,
          periodKey,
          transactionDate: date,
          description: template.description,
          amount: template.baseAmount.toDecimalString(),
          currency: template.baseAmount.currency,
          direction: template.direction,
          status: "pending", // comprometido: no cuenta como gasto ni mueve el saldo
          reviewed: true, // ya tiene la categoría de la plantilla: fuera del triage y de la IA
        },
      })
      return { transactionId: row.id, created: true }
    } catch {
      // Carrera con otra corrida del cron: el único de BD ya lo creó. Devolvemos ese.
      const row = await prisma.transaction.findFirstOrThrow({
        where: { recurringTemplateId: template.id, periodKey },
      })
      return { transactionId: row.id, created: false }
    }
  },
  async findPeriodTransaction(templateId, periodKey) {
    const row = await prisma.transaction.findFirst({
      where: { recurringTemplateId: templateId, periodKey },
      select: { id: true, status: true },
    })
    return row ?? null
  },
  async attachImportedMovement(transactionId, template, periodKey) {
    return prisma.$transaction(async (db) => {
      const committed = await db.transaction.findFirst({
        where: { recurringTemplateId: template.id, periodKey },
      })
      // El período ya tiene ejecución: este cargo no es de la plantilla, sigue el flujo normal.
      if (committed && committed.status !== "pending") return false
      if (committed && committed.id !== transactionId)
        await db.transaction.delete({ where: { id: committed.id } })
      const { count } = await db.transaction.updateMany({
        // El importado conserva su monto, fecha y externalId reales: solo adopta el vínculo.
        where: { id: transactionId },
        data: {
          categoryId: template.categoryId,
          recurringTemplateId: template.id,
          periodKey,
          status: "confirmed",
          reviewed: true,
        },
      })
      return count > 0
    })
  },
}
