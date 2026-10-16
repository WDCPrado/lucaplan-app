import type { Prisma } from "../database/prisma/generated/client.ts"
import { prisma } from "../database/prisma/client.ts"
import {
  amountDigits,
  amountPrefixRanges,
} from "../../domain/finance/amount-search.ts"
import {
  NotOwnerError,
  type Direction,
} from "../../domain/finance/finance.domain.ts"
import {
  deleteRejection,
  editRejection,
} from "../../application/finance-use-cases/update-transaction-use-case.ts"
import type { PluginToolInput } from "../../../../lib/schemas/plugin.ts"

const movementSelect = {
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
  externalId: true,
  recurringTemplateId: true,
  installmentItemId: true,
  incomeId: true,
  account: {
    select: { name: true, provider: true, bank: { select: { name: true } } },
  },
  category: { select: { name: true, type: true } },
  recurringTemplate: { select: { label: true } },
  installmentItem: {
    select: {
      index: true,
      planId: true,
      plan: {
        select: { description: true, kind: true, installmentsCount: true },
      },
    },
  },
  income: { select: { name: true } },
  installmentPlanAsSource: {
    select: { id: true, description: true, installmentsCount: true },
  },
} satisfies Prisma.TransactionSelect

type MovementRow = Prisma.TransactionGetPayload<{
  select: typeof movementSelect
}>

const SOURCE_LABEL = {
  bank_email: "Banco conectado por correo",
  income: "Generado desde una fuente de ingreso",
  recurring: "Recurrente (por cobrar o marcada como pagada a mano)",
  installment: "Cuota registrada por la app",
  manual: "Ingresado a mano",
} as const

// Procedencia, relaciones y capacidades efectivas: lo que el chat necesita para decidir qué
// herramienta usar sin probar y fallar. Las capacidades usan las MISMAS reglas que el caso de uso.
function movementView(row: MovementRow, duplicateInstallment = false) {
  const source: keyof typeof SOURCE_LABEL = row.externalId
    ? "bank_email"
    : row.incomeId
      ? "income"
      : row.recurringTemplateId
        ? "recurring"
        : row.installmentItemId
          ? "installment"
          : "manual"
  const account = { provider: row.account.provider }
  const editBlocked = editRejection(account)
  const deleteBlocked = deleteRejection(
    account,
    { direction: row.direction as Direction, categoryId: row.categoryId },
    duplicateInstallment
  )
  const linked = row.recurringTemplateId
    ? "recurrente"
    : row.installmentItemId || row.installmentPlanAsSource
      ? "plan de cuotas"
      : null
  return {
    id: row.id,
    date: row.transactionDate.toISOString().slice(0, 10),
    description: row.description,
    amount: Number(row.amount),
    currency: row.currency,
    direction: row.direction,
    status: row.status,
    isInternal: row.isInternal,
    affectsCash: row.status === "confirmed",
    countsInBudget:
      row.status === "confirmed" && !row.isInternal && row.categoryId !== null,
    accountId: row.accountId,
    accountName: row.account.name,
    bankName: row.account.bank.name,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    source,
    sourceLabel: SOURCE_LABEL[source],
    relations: {
      recurring: row.recurringTemplateId
        ? {
            id: row.recurringTemplateId,
            label: row.recurringTemplate?.label ?? null,
          }
        : null,
      installment:
        row.installmentItemId && row.installmentItem
          ? {
              planId: row.installmentItem.planId,
              itemId: row.installmentItemId,
              index: row.installmentItem.index,
              installmentsCount: row.installmentItem.plan.installmentsCount,
              planDescription: row.installmentItem.plan.description,
              kind: row.installmentItem.plan.kind,
            }
          : null,
      income: row.incomeId
        ? { id: row.incomeId, name: row.income?.name ?? null }
        : null,
      sourceOfInstallmentPlan: row.installmentPlanAsSource
        ? {
            planId: row.installmentPlanAsSource.id,
            description: row.installmentPlanAsSource.description,
            installmentsCount: row.installmentPlanAsSource.installmentsCount,
          }
        : null,
    },
    capabilities: {
      canEdit: editBlocked === null,
      editableFields:
        editBlocked !== null
          ? []
          : row.installmentItemId
            ? ["description", "date", "direction", "categoryId"]
            : ["description", "date", "amount", "direction", "categoryId"],
      editBlockedReason:
        editBlocked ??
        (row.installmentItemId
          ? "El monto de una cuota se corrige en el plan (lucaplan_editar_cuota)"
          : null),
      canDelete: deleteBlocked === null,
      deleteBlockedReason: deleteBlocked,
      canCategorize: true,
      categorizeNote: linked
        ? `Cambiar su categoría cambia la de todo el ${linked}; no puede quedar sin categoría`
        : null,
    },
  }
}

// Consulta acotada en la DB; nunca pagina después de traer todos los movimientos.
export async function searchPluginTransactions(
  userId: string,
  input: PluginToolInput<"lucaplan_buscar_movimientos">
) {
  const and: Prisma.TransactionWhereInput[] = []
  if (input.direction) and.push({ direction: input.direction })
  if (input.accountId) and.push({ accountId: input.accountId })
  if (input.currency) and.push({ currency: input.currency })
  if (input.categoryId) and.push({ categoryId: input.categoryId })
  if (input.bankName)
    and.push({ account: { bank: { name: input.bankName, userId } } })
  if (input.internal !== undefined) and.push({ isInternal: input.internal })
  if (input.from || input.to)
    and.push({
      transactionDate: {
        ...(input.from ? { gte: new Date(input.from) } : {}),
        ...(input.to ? { lte: new Date(input.to) } : {}),
      },
    })
  if (input.amountMin != null || input.amountMax != null)
    and.push({
      amount: {
        ...(input.amountMin != null ? { gte: input.amountMin } : {}),
        ...(input.amountMax != null ? { lte: input.amountMax } : {}),
      },
    })
  if (input.query)
    and.push({
      OR: [
        { description: { contains: input.query, mode: "insensitive" } },
        { category: { name: { contains: input.query, mode: "insensitive" } } },
        ...amountPrefixRanges(amountDigits(input.query)).map((range) => ({
          amount: { gte: range.gte, lt: range.lt },
        })),
      ],
    })
  // Estados explícitos mandan; sin ellos, el mismo criterio de elegibilidad que el buscador.
  if (input.status) and.push({ status: { in: input.status } })
  else if (input.settledOnly ?? true)
    and.push(
      { status: { notIn: ["reversed", "duplicated"] } },
      {
        NOT: {
          AND: [{ status: "pending" }, { recurringTemplateId: { not: null } }],
        },
      }
    )
  if (input.uncategorized)
    and.push({
      categoryId: null,
      status: { notIn: ["reversed", "duplicated"] },
      isInternal: false,
      reviewed: false,
    })
  const where: Prisma.TransactionWhereInput = { userId, AND: and }
  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
      skip: input.offset,
      take: input.limit,
      select: movementSelect,
    }),
    prisma.transaction.count({ where }),
  ])
  const hasMore = input.offset + rows.length < total
  return {
    items: rows.map((row) => movementView(row)),
    total,
    offset: input.offset,
    limit: input.limit,
    hasMore,
    nextOffset: hasMore ? input.offset + rows.length : null,
    order: "date desc, id desc",
  }
}

export async function getPluginTransaction(
  userId: string,
  transactionId: string,
  isDuplicateInstallment: () => Promise<boolean>
) {
  const row = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    select: movementSelect,
  })
  if (!row) throw new NotOwnerError()
  return movementView(row, await isDuplicateInstallment())
}
