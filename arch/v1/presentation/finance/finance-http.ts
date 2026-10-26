// Helpers HTTP para los Route Handlers financieros: resuelve el actor desde la sesión, inyecta los
// adapters, y mapea errores de dominio a status (401 sin sesión, 404 ownership/no-encontrado, 422
// regla de negocio; la lista vive en application/domain-error-status). Sin lógica de negocio.
import { cache } from "react"
import { ZodError } from "zod"

import { sessionGateway } from "../../infrastructure/auth/session.gateway.ts"
import { domainErrorStatus } from "../../application/domain-error-status.ts"
import {
  accountRepository,
  balanceBucketRepository,
  bankRepository,
  categoryRepository,
  monthlyBudgetRepository,
  transactionRepository,
} from "../../infrastructure/database/prisma/finance.infrastructure.ts"
import { correctionRepository } from "../../infrastructure/database/prisma/categorization-correction.infrastructure.ts"
import { incomeRepository } from "../../infrastructure/database/prisma/income.infrastructure.ts"
import { reimbursementReadRepository } from "../../infrastructure/database/prisma/reimbursement-read.infrastructure.ts"
import { recurringTemplateRepository } from "../../infrastructure/database/prisma/recurring.infrastructure.ts"
import { installmentPlanRepository } from "../../infrastructure/database/prisma/installment.infrastructure.ts"
import { budgetPeriodRepository } from "../../infrastructure/database/prisma/budget-period.infrastructure.ts"
import { currentBudgetPeriod } from "../../application/finance-use-cases/budget-period-use-cases.ts"
import { todayKey } from "../../../shared/today.ts"
import { openaiCategorizationProvider } from "../../infrastructure/http/ai/openai-categorization.provider.ts"
import { openaiBalanceScanReader } from "../../infrastructure/http/ai/openai-balance-scan.provider.ts"
import { openaiMovementScanReader } from "../../infrastructure/http/ai/openai-movement-scan.provider.ts"
import { exchangeRateProvider } from "../../infrastructure/http/exchange/usd-clp.ts"
import { memoizeReads, type MemoStore } from "./request-memo.ts"

// Todos los adapters, listos para inyectar en los use-cases. Crudos: cada lectura va a la base.
// ESTE es el que usan los Route Handlers y cualquier camino que escriba.
export const financeDeps = {
  accounts: accountRepository,
  banks: bankRepository,
  balanceBuckets: balanceBucketRepository,
  categories: categoryRepository,
  transactions: transactionRepository,
  monthlyBudgets: monthlyBudgetRepository,
  incomes: incomeRepository,
  reimbursements: reimbursementReadRepository,
  recurring: recurringTemplateRepository,
  installments: installmentPlanRepository,
  budgetPeriod: budgetPeriodRepository,
  categorization: openaiCategorizationProvider,
  balanceScan: openaiBalanceScanReader,
  movementScan: openaiMovementScanReader,
  corrections: correctionRepository,
  exchangeRates: exchangeRateProvider,
}

// Un almacén de memoización por render. `cache` de React le entrega uno nuevo a cada render de
// servidor y lo comparte entre todas las lecturas de ESE render: es lo que Next 16 documenta para
// deduplicar consultas a un ORM dentro de una misma carga.
const requestStore = cache((): MemoStore => new Map())

// Las mismas deps con las lecturas repetidas memoizadas (ver `request-memo.ts`). ESTE es el que
// usan los server components (`app/**/page.tsx`), que solo leen; las escrituras que ocurran en un
// render —hoy solo `materializeUserPeriods`— siguen recibiendo `financeDeps` crudo.
//
// La separación es a propósito y es el invariante que sostiene todo esto: **lo que escribe nunca
// lee de la memoria**. Antes eso dependía de que `cache` no tuviera ámbito fuera de un render, o
// sea de un detalle de React y de dónde acabara corriendo el código; ahora lo garantiza qué objeto
// importa cada archivo. Un camino que escriba y después lea —`updateIncome` seguido de
// `seedGlobalLimitFromIncomes`, por ejemplo— no puede leer un ingreso previo a su propia escritura
// aunque alguien lo mueva a una Server Action, porque no tiene de dónde.
export const financePageDeps = memoizeReads(financeDeps, requestStore)

function errorStatus(e: unknown): number {
  return domainErrorStatus(e) ?? 500
}

// Serializa a JSON tolerando BigInt (Money interno) → number. Red de seguridad: aunque un handler
// devuelva por error una entidad de dominio con Money, no crashea la respuesta (evita 500 fantasma).
function jsonResponse(data: unknown, status: number): Response {
  const body = JSON.stringify(data, (_k, v) =>
    typeof v === "bigint" ? Number(v) : v
  )
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  })
}

// Envuelve un handler: 401 sin sesión, serializa el resultado, mapea errores a status.
export async function withUser(
  req: Request,
  fn: (userId: string) => Promise<unknown>,
  okStatus = 200
): Promise<Response> {
  const actor = await sessionGateway.getActor(req.headers)
  if (!actor) return jsonResponse({ error: "unauthorized" }, 401)
  try {
    return jsonResponse(await fn(actor.userId), okStatus)
  } catch (e) {
    return jsonResponse(
      {
        error:
          e instanceof ZodError
            ? (e.issues[0]?.message ?? "Datos inválidos")
            : (e as Error).message,
      },
      errorStatus(e)
    )
  }
}

// year/month desde query params; por defecto el mes del presupuesto en curso según el modo
// (calendario o ciclo de la tarjeta), con el "hoy" del calendario del usuario. Puede leer la base:
// llámalo DENTRO del callback de `withUser`, así va después de la sesión y sus errores se mapean.
export async function periodOf(
  req: Request
): Promise<{ year: number; month: number }> {
  const sp = new URL(req.url).searchParams
  const year = Number(sp.get("year"))
  const month = Number(sp.get("month"))
  if (year && month) return { year, month }
  const now = await currentBudgetPeriod(financeDeps, todayKey())
  return { year: year || now.year, month: month || now.month }
}
