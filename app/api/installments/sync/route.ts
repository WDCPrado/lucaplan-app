import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { prisma } from "@/arch/v1/infrastructure/database/prisma/client"
import { todayKey } from "@/arch/shared/today"

// Corrige exclusivamente cuotas futuras huérfanas creadas por el generador antiguo.
// Un cargo importado, una cuota pagada/vinculada y cualquier coincidencia ambigua
// quedan intactos. Los movimientos sintéticos de cuotas se insertaban sin tocar
// el saldo de la cuenta: borrarlos directamente mantiene ese saldo inalterado.
export async function POST(req: Request) {
  return withUser(req, async (userId) => {
    const today = new Date(`${todayKey()}T00:00:00Z`)
    const plans = await prisma.installmentPlan.findMany({
      where: { userId },
      include: { items: { include: { transaction: { select: { id: true } } } } },
    })
    const candidates = await prisma.transaction.findMany({
      where: {
        userId,
        externalId: null,
        installmentItemId: null,
        recurringTemplateId: null,
        transactionDate: { gt: today },
        direction: "debit",
        status: "confirmed",
        reviewed: true,
        isInternal: false,
      },
      select: {
        id: true,
        accountId: true,
        categoryId: true,
        transactionDate: true,
        description: true,
        amount: true,
        currency: true,
      },
    })

    const expected = new Map<string, number>()
    for (const plan of plans) {
      for (const item of plan.items) {
        if (item.transaction || item.paidOutsideApp) continue
        const key = [
          plan.accountId, plan.categoryId,
          `${plan.description} · cuota ${item.index}/${plan.installmentsCount}`,
          item.dueDate.toISOString().slice(0, 10),
          item.amount.toString(), plan.currency,
        ].join("\u0001")
        expected.set(key, (expected.get(key) ?? 0) + 1)
      }
    }

    // La sincronización es conservadora: solo coincidencias únicas con cuota
    // pendiente y monto/fecha idénticos al cronograma. No adivina ni refactura.
    const matches = candidates.filter((t) => {
      const key = [
        t.accountId, t.categoryId, t.description,
        t.transactionDate.toISOString().slice(0, 10),
        t.amount.toString(), t.currency,
      ].join("\u0001")
      return expected.get(key) === 1
    })
    const counts = new Map<string, number>()
    for (const t of matches) {
      const key = [t.accountId, t.categoryId, t.description,
        t.transactionDate.toISOString().slice(0, 10), t.amount.toString(), t.currency,
      ].join("\u0001")
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const safe = matches.filter((t) => {
      const key = [t.accountId, t.categoryId, t.description,
        t.transactionDate.toISOString().slice(0, 10), t.amount.toString(), t.currency,
      ].join("\u0001")
      return counts.get(key) === 1
    })

    const result = await prisma.transaction.deleteMany({
      where: {
        id: { in: safe.map((t) => t.id) },
        userId, externalId: null, installmentItemId: null,
        recurringTemplateId: null, transactionDate: { gt: today },
      },
    })
    return { removed: result.count, skipped: candidates.length - result.count }
  })
}
