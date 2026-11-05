import { movementFinancialContext } from "../../application/finance-use-cases/movement-financial-context.ts"
import { effectiveLimit } from "../../application/finance-use-cases/budget-formulas.ts"
import { getBudgetPeriod } from "../../application/finance-use-cases/budget-period-use-cases.ts"
import { periodOfDay, periodRange } from "../../../shared/billing-cycle.ts"
import { categoryRepository } from "../database/prisma/finance.infrastructure.ts"
import { budgetPeriodRepository } from "../database/prisma/budget-period.infrastructure.ts"
import { exchangeRateProvider } from "../http/exchange/usd-clp.ts"
import type { Prisma } from "../database/prisma/generated/client.ts"
import { reconciliationLinks } from "../database/prisma/bank-reconciliation.infrastructure.ts"
import { canReconcileCorrection } from "../../domain/finance/bank-reconciliation.domain.ts"
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
  reconciliation: true,
  bankReceivedAt: true,
  updatedAt: true,
  recurringTemplateId: true,
  installmentItemId: true,
  incomeId: true,
  bucket: { select: { kind: true, currency: true } },
  account: {
    select: {
      name: true,
      provider: true,
      accountType: true,
      bank: { select: { name: true } },
    },
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
  reimbursementsPaid: { select: { amount: true } },
  reimbursementsReceived: { select: { amount: true } },
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
// herramienta usar sin probar y fallar. Editar y borrar usan las reglas de su caso de uso
// (`editRejection`, `deleteRejection`); corregir moneda, la regla única de la conciliación.
function movementView(
  row: MovementRow,
  context: ReturnType<typeof movementFinancialContext>,
  duplicateInstallment = false
) {
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
    revision: row.updatedAt.toISOString(),
    bankReceivedAt: row.bankReceivedAt?.toISOString() ?? null,
    bankReconciliation: row.reconciliation,
    date: row.transactionDate.toISOString().slice(0, 10),
    description: row.description,
    amount: Number(row.amount),
    currency: row.currency,
    direction: row.direction,
    status: row.status,
    isInternal: row.isInternal,
    ...context,
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
      canCorrectMetadata:
        !row.externalId &&
        !row.installmentItemId &&
        !row.recurringTemplateId &&
        !row.incomeId,
      canReconcile: ["checking", "credit_card"].includes(
        row.account.accountType
      ),
      canCorrectCurrency: canReconcileCorrection({
        ...row,
        ...reconciliationLinks(row),
      }),
      currencyCorrectionBlockedReason:
        "Usar previsualizar_conciliacion y aplicar_conciliacion con cartola y snapshot. Cobros recurrentes: settleRecurringCharge=true permite liquidar importe/moneda conservando categoría, vínculo y plan futuro. Para importes de cuotas loan y su total usa loanCorrections con el cronograma completo; conserva moneda y fechas. Para el total financiado y cuotas pendientes de card usa cardCorrections; conserva compra origen e importes registrados. Ingresos, reembolsos y transferencias internas tienen restricciones.",
      installmentCorrectionNote: row.installmentItem?.plan.kind === "loan"
        ? "Para corregir importe y total del préstamo usa loanCorrections en lucaplan_previsualizar_conciliacion y lucaplan_aplicar_conciliacion, con cartola, snapshot y todas sus cuotas; conserva fechas y vínculos"
        : row.installmentItem?.plan.kind === "card" || row.installmentPlanAsSource
          ? "Para corregir el total financiado y las cuotas pendientes usa cardCorrections en lucaplan_previsualizar_conciliacion y lucaplan_aplicar_conciliacion, con todas las cuotas y evidencia bancaria. Conserva la compra original y las cuotas registradas; no crea gastos ni modifica el cupo por esta diferencia"
          : null,
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

// Shared by list and detail: one configuration/limits read per response, one FX lookup per day.
async function contextualViews(
  userId: string,
  rows: MovementRow[],
  duplicateInstallment = false
) {
  if (!rows.length) return []
  const settings = await getBudgetPeriod({ budgetPeriod: budgetPeriodRepository })
  const limits = await categoryRepository.listLimitsByUser(userId, settings.mode)
  const dates = [
    ...new Set(
      rows
        .filter((row) => row.currency === "USD")
        .map((row) => row.transactionDate.toISOString().slice(0, 10))
    ),
  ]
  const rates = new Map(
    await Promise.all(
      dates.map(async (day) => {
        try {
          return [
            day,
            await exchangeRateProvider.clpPerUsdAt(new Date(day)),
          ] as const
        } catch {
          return [day, null] as const
        }
      })
    )
  )
  return rows.map((row) => {
    const day = row.transactionDate.toISOString().slice(0, 10)
    const period = periodOfDay(day, settings.mode, settings.overrides)
    const context = movementFinancialContext({
      amount: Number(row.amount),
      currency: row.currency,
      direction: row.direction,
      status: row.status,
      isInternal: row.isInternal,
      externalId: row.externalId,
      accountType: row.account.accountType,
      bucket: row.bucket,
      categoryType: row.category?.type ?? null,
      categoryLimit: row.categoryId
        ? effectiveLimit(
            limits,
            row.categoryId,
            period.year,
            period.month
          ).toMajor()
        : 0,
      clpPerUsd: rates.get(day) ?? null,
    })
    if (
      row.reconciliation &&
      typeof row.reconciliation === "object" &&
      !Array.isArray(row.reconciliation)
    ) {
      Object.assign(context.financialContext.reconciliation, {
        bankSettlementVerified: true,
        bankPostingDate: row.reconciliation.bankPostingDate ?? null,
        evidence: "bank_document_reconciliation",
        notice:
          "Conciliado con documento aportado; valores originales y evidencia en bankReconciliation. La conversión CLP del presupuesto sigue siendo referencial.",
      })
    }
    return {
      ...movementView(row, context, duplicateInstallment),
      budgetPeriod: {
        ...period,
        mode: settings.mode,
        range: periodRange(
          period.year,
          period.month,
          settings.mode,
          settings.overrides
        ),
      },
    }
  })
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
    items: await contextualViews(userId, rows),
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
  return (
    await contextualViews(userId, [row], await isDuplicateInstallment())
  )[0]
}
