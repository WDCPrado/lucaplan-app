import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { searchTransactions } from "@/arch/v1/application/finance-use-cases/finance-read"
import type { Direction } from "@/arch/v1/domain/finance/finance.domain"

// Búsqueda de movimientos con filtros combinados. Query params (todos opcionales):
// q (texto, insensible), direction (debit|credit), categoryId, bank (nombre), from, to (YYYY-MM-DD).
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const dir = sp.get("direction")
  return withUser(req, (userId) =>
    searchTransactions(financeDeps, userId, {
      query: sp.get("q")?.trim() || undefined,
      direction:
        dir === "debit" || dir === "credit" ? (dir as Direction) : undefined,
      categoryId: sp.get("categoryId") || undefined,
      bankName: sp.get("bank") || undefined,
      from: parseDate(sp.get("from")),
      to: parseDate(sp.get("to")),
      amountMin: parseNum(sp.get("amountMin")),
      amountMax: parseNum(sp.get("amountMax")),
      // Solo movimientos sin categoría elegibles (para el triage del onboarding).
      uncategorized: sp.get("uncategorized") === "1" || undefined,
    })
  )
}

function parseDate(s: string | null): Date | undefined {
  if (!s) return undefined
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function parseNum(s: string | null): number | undefined {
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}
