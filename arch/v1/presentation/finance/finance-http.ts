// Helpers HTTP para los Route Handlers financieros: resuelve el actor desde la sesión, inyecta los
// adapters, y mapea errores de dominio a status (401 sin sesión, 404 ownership/no-encontrado, 422
// regla de negocio). Sin lógica de negocio.
import { sessionGateway } from "../../infrastructure/auth/session.gateway.ts";
import {
  NotOwnerError,
  AccountNotFoundError,
  BudgetNotFoundError,
  CategoryNotFoundError,
  TransactionCurrencyMismatchError,
} from "../../domain/finance/finance.domain.ts";
import {
  accountRepository,
  bankRepository,
  budgetRepository,
  categoryRepository,
  transactionRepository,
} from "../../infrastructure/database/prisma/finance.infrastructure.ts";

// Todos los adapters, listos para inyectar en los use-cases.
export const financeDeps = {
  accounts: accountRepository,
  banks: bankRepository,
  budgets: budgetRepository,
  categories: categoryRepository,
  transactions: transactionRepository,
};

function errorStatus(e: unknown): number {
  if (e instanceof TransactionCurrencyMismatchError) return 422;
  if (
    e instanceof NotOwnerError ||
    e instanceof AccountNotFoundError ||
    e instanceof BudgetNotFoundError ||
    e instanceof CategoryNotFoundError
  )
    return 404;
  return 500;
}

// Envuelve un handler: 401 sin sesión, serializa el resultado, mapea errores a status.
export async function withUser(req: Request, fn: (userId: string) => Promise<unknown>, okStatus = 200): Promise<Response> {
  const actor = await sessionGateway.getActor(req.headers);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json(await fn(actor.userId), { status: okStatus });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: errorStatus(e) });
  }
}

// year/month desde query params; por defecto el mes actual (UTC).
export function periodOf(req: Request): { year: number; month: number } {
  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const year = Number(sp.get("year")) || now.getUTCFullYear();
  const month = Number(sp.get("month")) || now.getUTCMonth() + 1;
  return { year, month };
}
