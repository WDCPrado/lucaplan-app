// Adapter Postgres del port RecurringTemplateRepository. Mapea Prisma Decimal ↔ Money; el dominio
// no ve Prisma. El comprometido del período es una Transaction `pending`: NO ajusta el saldo de la
// cuenta (no se ha cobrado). La idempotencia por (plantilla, período) la impone el índice único
// (recurringTemplateId, periodKey), no una comprobación previa sujeta a carrera.
import { Prisma } from "./generated/client.ts"
import { prisma } from "./client.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import type { Direction } from "../../../domain/finance/finance.domain.ts"
import {
  canPayPeriod,
  matchesTemplateText,
  periodsAround,
  type Periodicity,
  type RecurringTemplate,
  type RecurringTemplateRepository,
} from "../../../domain/finance/recurring.domain.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTemplate(row: any): RecurringTemplate {
  const currency = row.currency as CurrencyCode
  return {
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    categoryId: row.categoryId,
    label: row.label,
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
    url: row.url ?? null,
  }
}

// Aborta el $transaction de `attachImportedMovement` para revertirlo; afuera se vuelve `false`.
class NotAttached extends Error {}

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
          label: input.label,
          description: input.description,
          direction: input.direction,
          baseAmount: input.baseAmount.toDecimalString(),
          currency: input.baseAmount.currency,
          tolerancePct: input.tolerancePct,
          periodicity: input.periodicity,
          dayOfMonth: input.dayOfMonth,
          startDate: input.startDate,
          endDate: input.endDate,
          url: input.url,
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
          label: input.label,
          // `description` (clave de match) NO se escribe: es inmutable desde el front.
          direction: input.direction,
          baseAmount: input.baseAmount.toDecimalString(),
          currency: input.baseAmount.currency,
          tolerancePct: input.tolerancePct,
          periodicity: input.periodicity,
          dayOfMonth: input.dayOfMonth,
          startDate: input.startDate,
          endDate: input.endDate,
          isActive: input.isActive,
          url: input.url,
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
    await returnMisplacedCharge(template, periodKey)
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
          description: template.label, // el comprometido muestra el nombre visible, no la clave
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
      select: { id: true, status: true, externalId: true, transactionDate: true, description: true },
    })
    // Sin `externalId` no vino del banco: es la marca manual del usuario (o el movimiento de
    // origen de la plantilla, que es la misma afirmación suya).
    return row
      ? {
          id: row.id,
          status: row.status,
          isManual: row.externalId === null,
          date: row.transactionDate,
          description: row.description,
        }
      : null
  },
  async listOpenPeriods(templateId) {
    const rows = await prisma.transaction.findMany({
      where: {
        recurringTemplateId: templateId,
        periodKey: { not: null },
        OR: [{ status: "pending" }, { status: "confirmed", externalId: null }],
      },
      select: { periodKey: true, status: true },
    })
    // Confirmado y en este where = sin externalId: la marca manual.
    return rows.flatMap((r) =>
      r.periodKey ? [{ periodKey: r.periodKey, isManual: r.status === "confirmed" }] : []
    )
  },
  async setPeriodPaid(templateId, periodKey, paid) {
    const { count } = await prisma.transaction.updateMany({
      where: {
        recurringTemplateId: templateId,
        periodKey,
        status: paid ? "pending" : "confirmed",
        // Deshacer solo alcanza a lo confirmado a mano. La comprobación del use-case da el error
        // legible; esta hace que una carrera no pueda revertir un cargo real igualmente.
        ...(paid ? {} : { externalId: null }),
      },
      // Monto y fecha se conservan: el comprometido ya los tiene, y los reales los fija el correo.
      data: { status: paid ? "confirmed" : "pending" },
    })
    return count > 0
  },
  async attachImportedMovement(transactionId, template, periodKey) {
    return prisma
      .$transaction(async (db) => {
        const committed = await db.transaction.findFirst({
          where: { recurringTemplateId: template.id, periodKey },
        })
        const bankCharge =
          committed !== null && committed.status !== "pending" && committed.externalId !== null
        // El período ya lo cerró el BANCO con el texto de la recurrente: dos cargos reales no se
        // pisan, este sigue el flujo normal.
        if (bankCharge && matchesTemplateText(committed.description, template)) return false
        if (committed && committed.id !== transactionId) {
          // Un cargo del banco con otro texto no es de esta recurrente (lo vinculó el match por
          // monto, ya retirado): se suelta y vuelve al triage, sin borrarlo. Conserva la categoría
          // que le puso el vínculo; el triage es donde la persona la corrige.
          if (bankCharge)
            await db.transaction.update({
              where: { id: committed.id },
              data: { recurringTemplateId: null, periodKey: null, reviewed: false },
            })
          // Queda el comprometido, o una ejecución confirmada A MANO por el usuario: el correo es el
          // hecho y la reemplaza. Conservar las dos contaría dos veces el mismo gasto.
          else await db.transaction.delete({ where: { id: committed.id } })
        }
        const { count } = await db.transaction.updateMany({
          // El importado conserva su monto, fecha y externalId reales: solo adopta el vínculo. Uno ya
          // vinculado a OTRA plantilla no se roba (dejaría ese período sin su cobro), ni uno ya
          // vinculado a otro período de esta se mueve (dejaría aquel sin cobro y borraría este).
          where: {
            id: transactionId,
            OR: [
              { recurringTemplateId: null },
              { recurringTemplateId: template.id, periodKey },
            ],
          },
          data: {
            categoryId: template.categoryId,
            recurringTemplateId: template.id,
            periodKey,
            status: "confirmed",
            reviewed: true,
          },
        })
        // Movimiento inexistente o de otra plantilla: se revierte el borrado del comprometido.
        if (count === 0) throw new NotAttached()
        // Recurrente planificada (sin clave de match): el primer cobro real vinculado le da su
        // clave, para que los próximos se reconozcan solos. Nunca pisa una clave ya fijada.
        if (!template.description.trim()) {
          const tx = await db.transaction.findUniqueOrThrow({
            where: { id: transactionId },
            select: { description: true },
          })
          await db.recurringTemplate.updateMany({
            where: { id: template.id, description: "" },
            data: { description: tx.description },
          })
        }
        return true
      })
      .catch((e) => {
        if (e instanceof NotAttached) return false
        // Carrera con `materializePeriod`: abrió el mismo período entre la lectura y el vínculo
        // (único plantilla+período). No se vincula: el movimiento queda para triage.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false
        throw e
      })
  },
}

// WDC-179: el vínculo viejo guardaba un cargo en el período siguiente (el del 4-oct en noviembre,
// con vencimiento el 5). Si el período tiene un cargo del banco que no lo puede pagar, vuelve al
// período que sí paga: el más antiguo de la ventana de su fecha (`periodsAround`, ya dentro de
// vigencia). Sin ninguno, no se mueve. El destino debe estar vacío o tener solo su comprometido (se
// borra: es el lugar que ocupa el cargo). Un cargo real ahí no se pisa, ni una fila confirmada a mano:
// puede ser la marca «Ya lo pagué» o el movimiento manual de origen de la plantilla, y borrarla
// perdería un movimiento real. Entonces el cargo se queda y solo la lectura
// (`periodTransactionPaying`) lo trata como no pagado. Solo cambia `periodKey`: monto, fecha y saldos
// quedan igual. Idempotente: corregido, ya no hay nada que mover.
async function returnMisplacedCharge(template: RecurringTemplate, periodKey: string) {
  const misplaced = (
    row: { status: string; externalId: string | null; transactionDate: Date } | null
  ) =>
    row !== null &&
    row.status === "confirmed" &&
    row.externalId !== null &&
    !canPayPeriod(template, periodKey, row.transactionDate)
  const select = { id: true, status: true, externalId: true, transactionDate: true } as const
  const where = { recurringTemplateId: template.id, periodKey }
  // Lo normal es que no haya nada que mover: se lee fuera de la transacción y solo se abre si hace falta.
  const first = await prisma.transaction.findFirst({ where, select })
  if (!first || !misplaced(first)) return
  const target = periodsAround(template, first.transactionDate)[0]?.periodKey
  if (!target || target === periodKey) return
  await prisma
    .$transaction(async (db) => {
      // Se vuelve a leer: otra corrida pudo corregirlo o el correo cambiar el período entretanto.
      const row = await db.transaction.findFirst({ where, select })
      if (!row || row.id !== first.id || !misplaced(row)) return
      const occupant = await db.transaction.findFirst({
        where: { recurringTemplateId: template.id, periodKey: target },
        select: { id: true, status: true },
      })
      if (occupant && occupant.status !== "pending") return
      if (occupant)
        await db.transaction.deleteMany({ where: { id: occupant.id, status: "pending" } })
      await db.transaction.update({ where: { id: row.id }, data: { periodKey: target } })
    })
    .catch((e) => {
      // Carrera con otra corrida que abrió el período destino: se deja como estaba.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return
      throw e
    })
}
