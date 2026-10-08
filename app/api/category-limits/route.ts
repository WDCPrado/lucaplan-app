import { categoryLimitSchema } from "@/lib/finance-form-schemas"
import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { setCategoryLimit } from "@/arch/v1/application/finance-use-cases/upsert-category-use-case"

// Fija el límite de una categoría para un mes concreto (year, month).
export async function POST(req: Request) {
  const body = await req.json()

  return withUser(req, async (userId) => {
    const parsed = categoryLimitSchema.parse({
      categoryId: body.categoryId,
      year: Number(body.year),
      month: Number(body.month),
      limit: Number(body.limit),
    })
    const l = await setCategoryLimit(financeDeps, userId, parsed)
    return { id: l.id }
  })
}
