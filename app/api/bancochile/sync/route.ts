import path from "node:path";
import { sessionGateway } from "@/arch/v1/infrastructure/auth/session.gateway";
import { withLock, LockBusyError } from "@/arch/shared/mutex";
import { BancoChileConnector } from "@/arch/v1/infrastructure/http/bancochile/bancochile.connector";
import { makeSyncLocalDeps } from "@/arch/v1/infrastructure/database/prisma/bancochile-sync.infrastructure";
import { syncLocalConnection } from "@/arch/v1/application/finance-use-cases/sync-local-connection-use-case";
import { loadBancoChileCreds } from "@/arch/v1/infrastructure/http/bancochile/bancochile-credentials";

// Sincronización manual con PROGRESO EN VIVO (Server-Sent Events): abre el navegador headless, se
// loguea con las credenciales cifradas de la DB, raspa e importa; emite cada paso. Lock por usuario.
// Patchright es external package (next.config) → no se bundlea.
function profileDir(userId: string): string {
  const base = process.env.BANCOCHILE_PROFILE_DIR ?? path.join(process.cwd(), ".bancochile-profile");
  return path.join(base, userId);
}

export async function POST(req: Request) {
  const actor = await sessionGateway.getActor(req.headers);
  if (!actor) return new Response("unauthorized", { status: 401 });
  const userId = actor.userId;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* stream cerrado */
        }
      };
      try {
        const result = await withLock(userId, async () => {
          const creds = (await loadBancoChileCreds(userId)) ?? undefined;
          const connector = new BancoChileConnector(profileDir(userId), { creds });
          try {
            // Timeout global: si algo se cuelga (launch/login), rechaza a los 4 min → cierra el
            // navegador y libera el lock (evita "carga infinita" y perfil bloqueado).
            return await Promise.race([
              syncLocalConnection(makeSyncLocalDeps(connector), userId, {
                onProgress: (p) => send({ type: "progress", ...p }),
              }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("La sincronización tardó demasiado (timeout). Reintenta.")), 4 * 60 * 1000),
              ),
            ]);
          } finally {
            await connector.close();
          }
        });
        send({ type: "done", result });
      } catch (e) {
        if (e instanceof LockBusyError) send({ type: "busy", error: "Ya hay una sincronización en curso" });
        else send({ type: "error", error: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}
