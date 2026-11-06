// Categorización IA best-effort de los movimientos pendientes de un usuario: solo confirmados,
// sin categoría y NO internos (abonos/pagos internos jamás se categorizan). Una falla del
// proveedor deja los movimientos sin categoría.
import { prisma } from "./client.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import type {
  Direction,
  MovementStatus,
} from "../../../domain/finance/finance.domain.ts"
import { categorizeMovements } from "../../../application/finance-use-cases/categorize-movements-use-case.ts"
import {
  categoryRepository,
  transactionRepository,
} from "./finance.infrastructure.ts"
import { openaiCategorizationProvider } from "../../http/ai/openai-categorization.provider.ts"
import { correctionRepository } from "./categorization-correction.infrastructure.ts"
import { pendingCategorizationFilter } from "./categorize-pending-filter.ts"

// Por páginas de 500, hasta `maxPages` o hasta vaciar: la carga inicial del correo trae 3 meses y
// puede pasar de 500. Avanza por id, así lo que la IA deja sin categoría no se vuelve a pedir en la
// misma pasada.
const PAGE = 500

export async function categorizePendingMovements(
  userId: string,
  maxPages = 1
): Promise<number> {
  let assigned = 0
  let afterId: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const rows = await prisma.transaction.findMany({
      where: {
        ...pendingCategorizationFilter(userId),
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: "asc" },
      take: PAGE,
    })
    if (rows.length === 0) return assigned
    afterId = rows[rows.length - 1].id
    assigned += await categorizeMovements(
      {
        transactions: transactionRepository,
        categories: categoryRepository,
        categorization: openaiCategorizationProvider,
        corrections: correctionRepository,
      },
      userId,
      rows.map((r) => ({
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
    )
    if (rows.length < PAGE) return assigned
  }
  return assigned
}
