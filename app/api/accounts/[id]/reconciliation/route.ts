import { z } from "zod"
import { bankReconciliationSchema } from "@/lib/schemas/bank-reconciliation"
import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { reconcileBankAccount } from "@/arch/v1/application/finance-use-cases/bank-reconciliation"
import { followIncome } from "@/arch/v1/application/finance-use-cases/follow-income"

const schema = bankReconciliationSchema
  .omit({ accountId: true })
  .extend({ previewToken: z.string().length(64).optional() })
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
    const { previewToken, ...input } = schema.parse(
      await req.json().catch(() => ({}))
    )
    const run = () =>
      reconcileBankAccount(financeDeps, userId, { ...input, accountId: id }, previewToken)
    // Sin previewToken es solo la previsualización: no escribe, no hay nada que seguir.
    return previewToken
      ? (await followIncome(financeDeps, userId, run, { allModes: true })).result
      : run()
  })
}
