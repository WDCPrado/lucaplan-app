import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { listLinkCandidates } from "@/arch/v1/application/finance-use-cases/installment-use-cases"

// Movimientos que el usuario puede asignar a una cuota: gastos suyos, sin plan, cerca de la fecha
// pedida. `accountId` acota a la cuenta del plan; sin él busca en todas (una cuota puede pagarse
// desde otra cuenta).
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const around = sp.get("around")
  const accountId = sp.get("accountId")
  return withUser(req, async (userId) => {
    const candidates = await listLinkCandidates(
      financeDeps,
      userId,
      around ? new Date(around) : new Date(),
      accountId ?? undefined
    )
    return candidates.map((c) => ({
      transactionId: c.transactionId,
      description: c.description,
      amount: c.amount.toMajor(),
      currency: c.amount.currency,
      date: c.date.toISOString(),
      accountName: c.accountName,
      categoryId: c.categoryId,
    }))
  })
}
