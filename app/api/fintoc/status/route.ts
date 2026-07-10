import { withUser } from "@/arch/v1/presentation/finance/finance-http";
import { getFintocSyncStatus } from "@/arch/v1/infrastructure/database/prisma/finance.infrastructure";
import { openaiConfigured } from "@/arch/v1/infrastructure/http/ai/openai-config";

// Estado de sincronización de los bancos conectados del usuario. Lo consume el loader de la primera
// conexión para saber cuándo el primer lote está importado y categorizado. `aiEnabled` indica si hay
// categorización con IA (si no, el loader no espera categorización).
export async function GET(req: Request) {
  return withUser(req, async (userId) => {
    const status = await getFintocSyncStatus(userId);
    return { ...status, aiEnabled: openaiConfigured() };
  });
}
