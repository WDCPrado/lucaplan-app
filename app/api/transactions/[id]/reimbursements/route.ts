import { prisma } from "@/arch/v1/infrastructure/database/prisma/client"
import { withUser, financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import { getLinkedTransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import { followIncome } from "@/arch/v1/application/finance-use-cases/follow-income"
import { linkReimbursement } from "@/arch/v1/infrastructure/database/prisma/reimbursement.infrastructure"
import { linkReimbursementSchema } from "@/lib/schemas/reimbursement"

// Ambos lados de un gasto compartido: detalle de los movimientos verdaderos,
// con comprobación de propiedad antes de devolver datos bancarios.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
    const source = await prisma.transaction.findFirst({ where: { id, userId } })
    if (!source) return { links: [] }
    const rows = await prisma.expenseReimbursement.findMany({
      where: { userId, OR: [{ expenseId: id }, { creditId: id }] },
      select: { id: true, expenseId: true, creditId: true, amount: true },
      orderBy: { createdAt: "asc" },
    })
    const links = await Promise.all(rows.map(async row => {
      const counterpartId = row.expenseId === id ? row.creditId : row.expenseId
      const transaction = await getLinkedTransactionDTO(financeDeps, userId, counterpartId)
      return transaction ? { id: row.id, amount: Number(row.amount), transaction } : null
    }))
    return { links: links.filter(link => link !== null) }
  })
}

// Vincula este abono ([id]) a un gasto (WDC-184). Mismo camino que la tool MCP: el abono cubierto
// entero deja de ser ingreso y el tope que sigue al ingreso se alinea. La propiedad de los dos
// movimientos la valida linkReimbursement (404 si alguno no es del usuario).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
    const input = linkReimbursementSchema.parse(await req.json().catch(() => ({})))
    const { result } = await followIncome(financeDeps, userId,
      () => linkReimbursement(userId, { ...input, creditId: id }), { allModes: true })
    return { reimbursementId: result.reimbursementId, amount: result.amount }
  })
}
