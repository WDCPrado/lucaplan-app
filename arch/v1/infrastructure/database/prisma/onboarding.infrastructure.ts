// Adapters Prisma del onboarding (WDC-181): la marca de terminado en `user`, qué categorías están
// en uso y el repo de categorías acotado a una transacción para guardar el set de una vez.
import type { Prisma } from "./generated/client.ts"
import { prisma } from "./client.ts"
import type {
  CategoryUsage,
  OnboardingRepository,
} from "../../../domain/onboarding/onboarding.domain.ts"
import type {
  Category,
  CategoryRepository,
  CategoryType,
} from "../../../domain/finance/finance.domain.ts"

export const onboardingRepository: OnboardingRepository = {
  async completedAt(userId) {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { onboardingCompletedAt: true },
    })
    return row?.onboardingCompletedAt ?? null
  },
  async markCompleted(userId, at) {
    // Solo si sigue sin marcar: dos clics simultáneos no pisan la primera fecha.
    await prisma.user.updateMany({
      where: { id: userId, onboardingCompletedAt: null },
      data: { onboardingCompletedAt: at },
    })
  },
}

// En uso = algo la referencia: movimientos, límites, recurrentes, planes de cuotas, ingresos
// (se irían en cascada) o efectos de reembolso (FK Restrict). Esas no se borran.
export const categoryUsageIn = (db: Prisma.TransactionClient): CategoryUsage => ({
  async usedCategoryIds(userId) {
    const rows = await db.category.findMany({
      where: {
        userId,
        OR: [
          { transactions: { some: {} } },
          { limits: { some: {} } },
          { recurring: { some: {} } },
          { installments: { some: {} } },
          { incomes: { some: {} } },
          { reimbursementEffects: { some: {} } },
        ],
      },
      select: { id: true },
    })
    return new Set(rows.map((r) => r.id))
  },
})

const toCategory = (row: {
  id: string
  userId: string
  name: string
  type: string
  icon: string | null
  color: string | null
  description: string | null
  paceEnabled: boolean
}): Category => ({ ...row, type: row.type as CategoryType })

// Lo mínimo que usa el guardado del onboarding, sobre el cliente de la transacción.
export const categoriesIn = (
  db: Prisma.TransactionClient
): Pick<CategoryRepository, "listByUser" | "upsert" | "delete"> => ({
  async listByUser(userId) {
    const rows = await db.category.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: "asc" },
    })
    return rows.map(toCategory)
  },
  async upsert(input) {
    const data = {
      userId: input.userId,
      name: input.name,
      type: input.type,
      icon: input.icon,
      color: input.color,
      description: input.description,
    }
    const row = input.id
      ? await db.category.update({ where: { id: input.id, userId: input.userId }, data })
      : await db.category.create({ data })
    return toCategory(row)
  },
  async delete(categoryId) {
    await db.category.delete({ where: { id: categoryId } })
  },
})
