import { financeDeps } from "@/arch/v1/presentation/finance/finance-http";
import { fintocConfig } from "@/lib/fintoc/config";
import { verifyFintocSignature } from "@/arch/v1/infrastructure/http/fintoc/webhook";
import { verifyUid } from "@/arch/v1/infrastructure/http/fintoc/uid-token";
import { syncLink } from "@/arch/v1/application/finance-use-cases/sync-link-use-case";

// Webhook de Fintoc. Dos caminos:
//  A) Conexión desde el widget: la URL lleva `?uid=<firmado>` (usuario que conectó) y el body trae
//     el `link_token` del banco recién vinculado → se crea/actualiza el banco y se sincroniza.
//  B) Actualización (webhook del dashboard, sin uid): se verifica la firma de Fintoc y se resuelve
//     el banco por el id del Link → re-sync. Idempotente: reprocesar no duplica.
// Responde 200 siempre que reconoce la petición (evita reintentos en bucle); la sync es idempotente.
export async function POST(req: Request) {
  const raw = await req.text();
  const event = safeParse(raw);
  const d = event?.data ?? {};
  const obj = d.object ?? d; // el body puede traer el Link en `data` o en `data.object`
  const linkToken: string | null = d.link_token ?? obj.link_token ?? null;
  const linkId: string | null = obj.id ?? d.link_id ?? d.id ?? null;
  const institutionName: string = obj.institution?.name ?? d.institution?.name ?? "Banco";

  // A) Conexión del widget: uid firmado por nosotros + link_token del body.
  // La sync corre en background: respondemos 200 ya (Fintoc espera un ack rápido; si tardamos,
  // reintenta). Es idempotente, así que un reintento no duplica.
  const userId = verifyUid(new URL(req.url).searchParams.get("uid"));
  if (userId && linkToken && linkId) {
    void syncLink(financeDeps, userId, { linkId, linkToken, institutionName }).catch((e) =>
      console.error("[fintoc webhook] sync (connect) falló:", e),
    );
    return json({ received: true }, 200);
  }

  // B) Actualización del dashboard: sin uid → exige firma válida de Fintoc y banco ya conocido.
  const secret = (() => {
    try {
      return fintocConfig().webhookSecret;
    } catch {
      return null;
    }
  })();
  if (linkId && verifyFintocSignature(raw, req.headers.get("fintoc-signature"), secret)) {
    const bank = await financeDeps.banks.findByExternalLinkId(linkId);
    if (bank?.provider === "fintoc" && bank.externalLinkId && bank.linkToken) {
      void syncLink(financeDeps, bank.userId, {
        linkId: bank.externalLinkId,
        linkToken: bank.linkToken,
        institutionName: bank.name,
      }).catch((e) => console.error("[fintoc webhook] sync (update) falló:", e));
    }
    return json({ received: true }, 200);
  }

  // No autenticado ni reconocible → rechazar.
  return json({ error: "unauthorized" }, 401);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function safeParse(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
