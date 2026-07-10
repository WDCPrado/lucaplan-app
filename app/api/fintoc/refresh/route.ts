import { withUser, financeDeps } from "@/arch/v1/presentation/finance/finance-http";
import { refreshConnection } from "@/arch/v1/application/finance-use-cases/refresh-connection-use-case";

// Refresco manual de un banco conectado (respaldo del webhook). Re-sincroniza idempotente.
export async function POST(req: Request) {
  const body = await req.json();
  return withUser(req, (userId) => refreshConnection(financeDeps, userId, String(body.bankId ?? "")));
}
