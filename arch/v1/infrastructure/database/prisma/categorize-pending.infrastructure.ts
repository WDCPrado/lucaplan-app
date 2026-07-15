// Categorización IA best-effort de los movimientos pendientes de un usuario: solo confirmados,
// sin categoría y NO internos (abonos/pagos internos jamás se categorizan). Una falla del
// proveedor deja los movimientos sin categoría.
import { prisma } from "./client.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import type {
  Direction,
  MovementStatus,
  Transaction,
} from "../../../domain/finance/finance.domain.ts"
import { categorizeMovements } from "../../../application/finance-use-cases/categorize-movements-use-case.ts"
import {
  categoryRepository,
  transactionRepository,
} from "./finance.infrastructure.ts"
import { openaiCategorizationProvider } from "../../http/ai/openai-categorization.provider.ts"
import { correctionRepository } from "./categorization-correction.infrastructure.ts"
import { pendingCategorizationFilter } from "./categorize-pending-filter.ts"

export async function categorizePendingMovements(
  userId: string
): Promise<number> {
  const rows = await prisma.transaction.findMany({
    where: pendingCategorizationFilter(userId),
    take: 500,
  })
  if (rows.length === 0) return 0
  const movements: Transaction[] = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    accountId: r.accountId,
    categoryId: null,
    date: r.transactionDate,
    description: r.description,
    amount: Money.of(r.amount.toString(), r.currency as CurrencyCode),
    direction: r.direction as Direction,
    status: (r.status ?? "confirmed") as MovementStatus,
    isInternal: r.isInternal ?? false,
    externalId: r.externalId ?? null,
  }))
  return categorizeMovements(
    {
      transactions: transactionRepository,
      categories: categoryRepository,
      categorization: openaiCategorizationProvider,
      corrections: correctionRepository,
    },
    userId,
    movements
  )
}
