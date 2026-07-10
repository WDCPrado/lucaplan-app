import { withUser, financeDeps } from "@/arch/v1/presentation/finance/finance-http";
import { connectBank } from "@/arch/v1/application/finance-use-cases/connect-bank-use-case";

// Conectar banco: el cliente manda el Link que entregó el widget (onSuccess). El backend valida el
// linkToken contra Fintoc (secret key server-only) y hace la primera sincronización.
export async function POST(req: Request) {
  const body = await req.json();
  return withUser(
    req,
    (userId) =>
      connectBank(financeDeps, userId, {
        linkId: String(body.linkId ?? ""),
        linkToken: String(body.linkToken ?? ""),
        institutionName: String(body.institutionName ?? "Banco"),
      }),
    201,
  );
}
