// Corrida de sincronización con Banco de Chile para CRON / tarea programada (background hands-off).
// Auto-login headless con las credenciales del entorno; sin 2FA (BCH no lo pide para consultar).
// Cadencia recomendada: 1-2 veces al día (no cada minuto) para no gatillar el anti-bot.
//
//   pnpm sync:bank
//   # o programado (Windows Task Scheduler / cron) apuntando a ese comando.
//
// Requiere en .env: BCH_RUT, BCH_PASS y (BANCOCHILE_USER_EMAIL o BANCOCHILE_USER_ID).
import path from "node:path";
import { BancoChileConnector } from "../arch/v1/infrastructure/http/bancochile/bancochile.connector.ts";
import { makeSyncLocalDeps } from "../arch/v1/infrastructure/database/prisma/bancochile-sync.infrastructure.ts";
import { syncLocalConnection } from "../arch/v1/application/finance-use-cases/sync-local-connection-use-case.ts";
import { loadBancoChileCreds } from "../arch/v1/infrastructure/http/bancochile/bancochile-credentials.ts";
import { prisma } from "../arch/v1/infrastructure/database/prisma/client.ts";

async function resolveUserId(): Promise<string> {
  if (process.env.BANCOCHILE_USER_ID) return process.env.BANCOCHILE_USER_ID;
  const email = process.env.BANCOCHILE_USER_EMAIL;
  if (email) {
    const u = await prisma.user.findFirst({ where: { email } });
    if (u) return u.id;
    throw new Error(`No hay usuario con email ${email}.`);
  }
  const only = await prisma.user.findFirst(); // uso personal: único usuario
  if (!only) throw new Error("No hay usuarios. Configura BANCOCHILE_USER_ID o BANCOCHILE_USER_EMAIL.");
  return only.id;
}

const userId = await resolveUserId();
const base = process.env.BANCOCHILE_PROFILE_DIR ?? path.join(process.cwd(), ".bancochile-profile");
const creds = (await loadBancoChileCreds(userId)) ?? undefined; // cifradas en DB; fallback al entorno
const connector = new BancoChileConnector(path.join(base, userId), { creds, headless: process.env.BCH_HEADLESS !== "false" });
try {
  const res = await syncLocalConnection(makeSyncLocalDeps(connector), userId);
  console.log(`[${new Date().toISOString()}] Sync OK:`, res);
} catch (e) {
  console.error(`[${new Date().toISOString()}] Sync FALLÓ:`, (e as Error).message);
  process.exitCode = 1;
} finally {
  await connector.close();
  await prisma.$disconnect();
}
