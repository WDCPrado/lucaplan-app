// Paso de match contra plantillas recurrentes para el import de correo: corre ANTES de la IA.
// Lo que reclama una plantilla queda con su categoría, vinculado al período y revisado, así que la
// IA ya no lo ve (el filtro de categorización excluye lo que tiene categoría y lo revisado).
import { prisma } from "./client.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import type { Direction } from "../../../domain/finance/finance.domain.ts"
import { confirmFromMovement } from "../../../application/finance-use-cases/recurring-use-cases.ts"
import { recurringTemplateRepository } from "./recurring.infrastructure.ts"

/** Devuelve cuántos movimientos recién importados quedaron vinculados a una plantilla. */
export async function matchRecurringForImported(
  userId: string,
  externalIds: string[]
): Promise<number> {
  if (externalIds.length === 0) return 0
  const templates = await recurringTemplateRepository.listActiveByUser(userId)
  if (templates.length === 0) return 0

  const movements = await prisma.transaction.findMany({
    where: {
      userId,
      externalId: { in: externalIds },
      isInternal: false,
      recurringTemplateId: null,
    },
  })

  let matched = 0
  for (const row of movements) {
    const claimed = await confirmFromMovement(
      { recurring: recurringTemplateRepository },
      templates,
      {
        id: row.id,
        description: row.description,
        amount: Money.of(row.amount.toString(), row.currency as CurrencyCode),
        direction: row.direction as Direction,
        date: row.transactionDate,
      }
    )
    if (claimed) matched++
  }
  return matched
}
