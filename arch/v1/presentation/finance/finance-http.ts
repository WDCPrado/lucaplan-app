// Helpers HTTP para los Route Handlers financieros: resuelve el actor desde la sesión, inyecta los
// adapters, y mapea errores de dominio a status (401 sin sesión, 404 ownership/no-encontrado, 422
// regla de negocio). Sin lógica de negocio.
import { cache } from "react"

import { sessionGateway } from "../../infrastructure/auth/session.gateway.ts"
import {
  NotOwnerError,
  AccountNotFoundError,
  CategoryInUseError,
  CategoryNotFoundError,
  InvalidMonthlyBudgetError,
  TransactionCurrencyMismatchError,
  CardLast4RequiredError,
  ConnectedAccountReadOnlyError,
  BankConnectionError,
  WebhookSignatureError,
} from "../../domain/finance/finance.domain.ts"
import {
  ConnectionMethodConflictError,
  EmailConnectionNotFoundError,
  EmailReauthRequiredError,
  EmailSetupStateError,
  OAuthStateError,
} from "../../domain/finance/email-connection.domain.ts"
import {
  InvalidIncomeError,
  IncomeNotFoundError,
} from "../../domain/finance/income.domain.ts"
import { InvalidPaceFrequencyError } from "../../domain/finance/pace.domain.ts"
import { BalanceScanError } from "../../domain/finance/balance-scan.domain.ts"
import { MovementScanError } from "../../domain/finance/movement-scan.domain.ts"
import {
  InvalidRecurringTemplateError,
  RecurringCategoryRequiredError,
  RecurringTemplateEndedError,
  RecurringTemplateNotFoundError,
} from "../../domain/finance/recurring.domain.ts"
import {
  InstallmentAccountMismatchError,
  InstallmentAmountReadOnlyError,
  InstallmentCategoryRequiredError,
  InstallmentItemAlreadySettledError,
  InstallmentPlanNotFoundError,
  InstallmentSplitMismatchError,
  InvalidInstallmentPlanError,
} from "../../domain/finance/installment.domain.ts"
import {
  DuplicateBudgetAlertError,
  InvalidBudgetAlertError,
} from "../../domain/notifications/budget-alert.domain.ts"
import { InvalidDueDaysError } from "../../domain/notifications/due-reminder.domain.ts"
import { LockBusyError } from "../../../shared/mutex.ts"
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
import { recurringTemplateRepository } from "../../infrastructure/database/prisma/recurring.infrastructure.ts"
import { installmentPlanRepository } from "../../infrastructure/database/prisma/installment.infrastructure.ts"
import { openaiCategorizationProvider } from "../../infrastructure/http/ai/openai-categorization.provider.ts"
import { openaiBalanceScanReader } from "../../infrastructure/http/ai/openai-balance-scan.provider.ts"
import { openaiMovementScanReader } from "../../infrastructure/http/ai/openai-movement-scan.provider.ts"
import { exchangeRateProvider } from "../../infrastructure/http/exchange/usd-clp.ts"
import { memoizeReads, type MemoStore } from "./request-memo.ts"

// Un almacén de memoización por request. `cache` de React le entrega uno nuevo a cada render de
// servidor y lo comparte entre todas las lecturas de ESE render: es lo que Next 16 documenta para
// deduplicar consultas a un ORM dentro de una misma carga. Fuera de un render —Route Handlers,
// scripts, cron— devuelve uno nuevo en cada llamada, así que no memoiza nada y todo sigue igual.
const requestStore = cache((): MemoStore => new Map())

// Todos los adapters, listos para inyectar en los use-cases. Las lecturas que varias vistas de una
// misma carga piden idénticas van memoizadas por request (ver `request-memo.ts`): las firmas no
// cambian y los use-cases no se enteran.
export const financeDeps = memoizeReads(
  {
    accounts: accountRepository,
    banks: bankRepository,
    balanceBuckets: balanceBucketRepository,
    categories: categoryRepository,
    transactions: transactionRepository,
    monthlyBudgets: monthlyBudgetRepository,
    incomes: incomeRepository,
    recurring: recurringTemplateRepository,
    installments: installmentPlanRepository,
    categorization: openaiCategorizationProvider,
    balanceScan: openaiBalanceScanReader,
    movementScan: openaiMovementScanReader,
    corrections: correctionRepository,
    exchangeRates: exchangeRateProvider,
  },
  requestStore
)

function errorStatus(e: unknown): number {
  if (e instanceof WebhookSignatureError || e instanceof OAuthStateError)
    return 401
  if (e instanceof LockBusyError) return 409 // sync ya en curso
  if (e instanceof ConnectionMethodConflictError) return 409 // otro método de conexión activo
  if (e instanceof DuplicateBudgetAlertError) return 409 // ya existe una alerta a ese %
  if (
    e instanceof InvalidBudgetAlertError ||
    e instanceof InvalidDueDaysError ||
    e instanceof InvalidPaceFrequencyError
  )
    return 422
  if (
    e instanceof TransactionCurrencyMismatchError ||
    e instanceof CategoryInUseError ||
    e instanceof CardLast4RequiredError ||
    e instanceof ConnectedAccountReadOnlyError ||
    e instanceof BankConnectionError ||
    e instanceof InvalidMonthlyBudgetError ||
    e instanceof InvalidIncomeError ||
    e instanceof InvalidRecurringTemplateError ||
    e instanceof RecurringCategoryRequiredError ||
    e instanceof RecurringTemplateEndedError ||
    e instanceof InvalidInstallmentPlanError ||
    e instanceof InstallmentAccountMismatchError ||
    e instanceof InstallmentSplitMismatchError ||
    e instanceof InstallmentItemAlreadySettledError ||
    e instanceof InstallmentCategoryRequiredError ||
    e instanceof InstallmentAmountReadOnlyError ||
    e instanceof EmailReauthRequiredError ||
    e instanceof EmailSetupStateError ||
    e instanceof BalanceScanError ||
    e instanceof MovementScanError
  )
    return 422
  if (
    e instanceof NotOwnerError ||
    e instanceof AccountNotFoundError ||
    e instanceof CategoryNotFoundError ||
    e instanceof IncomeNotFoundError ||
    e instanceof RecurringTemplateNotFoundError ||
    e instanceof InstallmentPlanNotFoundError ||
    e instanceof EmailConnectionNotFoundError
  )
    return 404
  return 500
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
    return jsonResponse({ error: (e as Error).message }, errorStatus(e))
  }
}

// year/month desde query params; por defecto el mes actual (UTC).
export function periodOf(req: Request): { year: number; month: number } {
  const sp = new URL(req.url).searchParams
  const now = new Date()
  const year = Number(sp.get("year")) || now.getUTCFullYear()
  const month = Number(sp.get("month")) || now.getUTCMonth() + 1
  return { year, month }
}
