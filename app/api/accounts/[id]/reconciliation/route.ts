import { z } from "zod"
import { bankReconciliationSchema } from "@/lib/schemas/bank-reconciliation"
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { reconcileBankAccount } from "@/arch/v1/infrastructure/database/prisma/bank-reconciliation.infrastructure"

const schema = bankReconciliationSchema
  .omit({ accountId: true })
  .extend({ previewToken: z.string().length(64).optional() })
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
    const { previewToken, ...input } = schema.parse(await req.json())
    return reconcileBankAccount(
      userId,
      { ...input, accountId: id },
      previewToken
    )
  })
}
