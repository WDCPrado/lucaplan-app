// Token de ingesta del usuario logueado (para pegar en el userscript/extensión). Stateless (HMAC).
import { withUser } from "@/arch/v1/presentation/finance/finance-http";
import { makeIngestToken } from "@/arch/v1/infrastructure/http/bancochile/ingest-token";

export async function GET(req: Request) {
  return withUser(req, async (userId) => ({ token: makeIngestToken(userId) }));
}
