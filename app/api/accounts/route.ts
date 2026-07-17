import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { listAccounts } from "@/arch/v1/application/finance-use-cases/finance-read"
import { createAccount } from "@/arch/v1/application/finance-use-cases/create-account-use-case"

export async function GET(req: Request) {
  return withUser(req, (userId) => listAccounts(financeDeps, userId))
}

export async function POST(req: Request) {
  const body = await req.json()
  return withUser(
    req,
    async (userId) => {
      const a = await createAccount(financeDeps, userId, {
        bankName: body.bankName || "Mi banco",
        name: body.name,
        accountType: body.accountType || "checking",
        currency: body.currency || "CLP",
        balance: Number(body.balance) || 0,
        overdraftLimit: Number(body.overdraftLimit) || 0,
        color: body.color ?? null,
        cardLast4: body.cardLast4 ?? null,
      })
      return { id: a.id, name: a.name }
    },
    201
  )
}
