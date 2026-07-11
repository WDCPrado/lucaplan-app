// Store de credenciales del banco (RUT + clave cifrada) para el auto-login. La clave se cifra al
// guardar y se descifra solo al usar (en el proceso local que abre el navegador). Nunca sale en claro
// por la API.
import { prisma } from "../../database/prisma/client.ts";
import { encryptSecret, decryptSecret } from "./crypto.ts";
import type { BancoChileCreds } from "./bancochile.connector.ts";

const PROVIDER = "bancochile";

export async function saveBancoChileCreds(userId: string, rut: string, pass: string): Promise<void> {
  const { enc, iv } = encryptSecret(pass);
  await prisma.bankCredential.upsert({
    where: { userId_provider: { userId, provider: PROVIDER } },
    create: { userId, provider: PROVIDER, rut, passEnc: enc, iv },
    update: { rut, passEnc: enc, iv },
  });
}

// Credenciales descifradas para el conector. null si no hay guardadas (cae al entorno o falla).
export async function loadBancoChileCreds(userId: string): Promise<BancoChileCreds | null> {
  const row = await prisma.bankCredential.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } } });
  if (!row) return null;
  return { rut: row.rut, pass: decryptSecret(row.passEnc, row.iv) };
}

// Estado para la UI (sin exponer la clave): ¿ya hay credenciales? y el RUT (no secreto).
export async function bancoChileCredStatus(userId: string): Promise<{ configured: boolean; rut: string | null }> {
  const row = await prisma.bankCredential.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
    select: { rut: true },
  });
  return { configured: !!row, rut: row?.rut ?? null };
}

export async function deleteBancoChileCreds(userId: string): Promise<void> {
  await prisma.bankCredential.deleteMany({ where: { userId, provider: PROVIDER } });
}
