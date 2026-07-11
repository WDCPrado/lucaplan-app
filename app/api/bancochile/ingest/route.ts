// Ingesta LOCAL de Banco de Chile: recibe el JSON crudo que el userscript/extensión leyó desde el
// navegador del usuario (su sesión real, sin automatización → sin anti-bot), lo mapea y persiste con
// el mismo pipeline (`syncLocalConnection`). Auth por token stateless (HMAC del userId). No importa
// Patchright → no bundlea navegador.
import { verifyIngestToken } from "@/arch/v1/infrastructure/http/bancochile/ingest-token";
import { PostedBankConnector } from "@/arch/v1/infrastructure/http/bancochile/posted-bank.connector";
import { makeSyncLocalDeps } from "@/arch/v1/infrastructure/database/prisma/bancochile-sync.infrastructure";
import { syncLocalConnection } from "@/arch/v1/application/finance-use-cases/sync-local-connection-use-case";
import { withLock, LockBusyError } from "@/arch/shared/mutex";
import type { BchRawData } from "@/arch/v1/infrastructure/http/bancochile/bancochile-map";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { token?: string; data?: BchRawData } | null;
  const userId = verifyIngestToken(body?.token);
  if (!userId || !body?.data) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await withLock(userId, async () => {
      const connector = new PostedBankConnector(body.data!);
      return syncLocalConnection(makeSyncLocalDeps(connector), userId);
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof LockBusyError) return Response.json({ error: "Ya hay una sincronización en curso" }, { status: 409 });
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
