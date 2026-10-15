import type { Prisma } from "../database/prisma/generated/client.ts"
import { prisma } from "../database/prisma/client.ts"
import {
  amountDigits,
  amountPrefixRanges,
} from "../../domain/finance/amount-search.ts"
import type { PluginToolInput } from "../../../../lib/schemas/plugin.ts"

// Consulta acotada en la DB; nunca pagina después de traer todos los movimientos.
export async function searchPluginTransactions(
  userId: string,
  input: PluginToolInput<"lucaplan_buscar_movimientos">
) {
  const where: Prisma.TransactionWhereInput = { userId }
  if (input.direction) where.direction = input.direction
  if (input.categoryId) where.categoryId = input.categoryId
  if (input.bankName) where.account = { bank: { name: input.bankName, userId } }
  if (input.from || input.to)
    where.transactionDate = {
      ...(input.from ? { gte: new Date(input.from) } : {}),
      ...(input.to ? { lte: new Date(input.to) } : {}),
    }
  if (input.amountMin != null || input.amountMax != null)
    where.amount = {
      ...(input.amountMin != null ? { gte: input.amountMin } : {}),
      ...(input.amountMax != null ? { lte: input.amountMax } : {}),
    }
  if (input.query)
    where.OR = [
      { description: { contains: input.query, mode: "insensitive" } },
      { category: { name: { contains: input.query, mode: "insensitive" } } },
      ...amountPrefixRanges(amountDigits(input.query)).map((range) => ({
        amount: { gte: range.gte, lt: range.lt },
      })),
    ]
  // Mismo criterio de elegibilidad que el buscador de la app.
  if (input.settledOnly ?? true) {
    where.status = { notIn: ["reversed", "duplicated"] }
    where.NOT = {
      AND: [{ status: "pending" }, { recurringTemplateId: { not: null } }],
    }
  }
  if (input.uncategorized) {
    where.categoryId = null
    where.status = { notIn: ["reversed", "duplicated"] }
    where.isInternal = false
    where.reviewed = false
  }
  const rows = await prisma.transaction.findMany({
    where,
    orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
    skip: input.offset,
    take: input.limit + 1,
    select: {
      id: true,
      accountId: true,
      categoryId: true,
      transactionDate: true,
      description: true,
      amount: true,
      currency: true,
      direction: true,
      status: true,
      isInternal: true,
      recurringTemplateId: true,
      installmentItemId: true,
      account: { select: { name: true, bank: { select: { name: true } } } },
      category: { select: { name: true } },
    },
  })
  return {
    items: rows.slice(0, input.limit).map((row) => ({
      id: row.id,
      accountId: row.accountId,
      accountName: row.account.name,
      bankName: row.account.bank.name,
      categoryId: row.categoryId,
      categoryName: row.category?.name ?? null,
      date: row.transactionDate.toISOString().slice(0, 10),
      description: row.description,
      amount: Number(row.amount),
      currency: row.currency,
      direction: row.direction,
      status: row.status,
      isInternal: row.isInternal,
      recurringTemplateId: row.recurringTemplateId,
      installmentItemId: row.installmentItemId,
    })),
    nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
  }
}
