// Desconectar Banco de Chile: borra la conexión (banco → cuentas, tarjetas, buckets y movimientos por
// cascade), las credenciales cifradas y el perfil del navegador (cookies). Deja al usuario como si
// nunca hubiera conectado.
import { rm } from "node:fs/promises";
import path from "node:path";
import { withUser } from "@/arch/v1/presentation/finance/finance-http";
import { prisma } from "@/arch/v1/infrastructure/database/prisma/client";
import { deleteBancoChileCreds } from "@/arch/v1/infrastructure/http/bancochile/bancochile-credentials";

function profileDir(userId: string): string {
  const base = process.env.BANCOCHILE_PROFILE_DIR ?? path.join(process.cwd(), ".bancochile-profile");
  return path.join(base, userId);
}

export async function POST(req: Request) {
  return withUser(req, async (userId) => {
    // El FK ON DELETE CASCADE del banco elimina sus cuentas y, con ellas, tarjetas, buckets y movimientos.
    await prisma.bank.deleteMany({ where: { userId, provider: "bancochile" } });
    await deleteBancoChileCreds(userId);
    await rm(profileDir(userId), { recursive: true, force: true }).catch(() => {});
    return { ok: true };
  });
}
