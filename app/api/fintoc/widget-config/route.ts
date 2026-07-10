import { withUser } from "@/arch/v1/presentation/finance/finance-http";
import { fintocWebhookBase } from "@/lib/fintoc/config";
import { signUid } from "@/arch/v1/infrastructure/http/fintoc/uid-token";

// Config del widget para el cliente: el `webhookUrl` (con `uid` firmado) donde Fintoc entregará el
// `link_token` del banco recién conectado. La public key la tiene el cliente vía NEXT_PUBLIC.
export async function POST(req: Request) {
  return withUser(req, async (userId) => ({
    webhookUrl: `${fintocWebhookBase()}/api/fintoc/webhook?uid=${signUid(userId)}`,
  }));
}
