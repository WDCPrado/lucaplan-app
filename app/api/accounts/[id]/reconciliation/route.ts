import { z } from "zod"
import { bankReconciliationSchema } from "@/lib/schemas/bank-reconciliation"
import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { reconcileBankAccount } from "@/arch/v1/application/finance-use-cases/bank-reconciliation"

const schema = bankReconciliationSchema
  .omit({ accountId: true })
  .extend({ previewToken: z.string().length(64).optional() })
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  return withUser(req, async (userId) => {
    const { previewToken, ...input } = schema.parse(body)
    return reconcileBankAccount(
      financeDeps,
      userId,
      { ...input, accountId: id },
      previewToken
    )
  })
}
