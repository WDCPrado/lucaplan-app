// Correo de la cuenta demo: el banco conectado por correo con un buzón Outlook activo y otro con la
// autorización caída («Reconectar este correo»). En el entorno de PR no se puede conectar de verdad
// (Entra exige registrar la redirect URI y cada PR estrena subdominio), así que se siembran. El
// refresh token es basura CIFRADA a propósito: sincronizar o reconectar desde acá falla.
import { encryptSecret, EMAIL_PURPOSE } from "../../../../arch/v1/infrastructure/crypto/secret-crypto.ts"
import type { DemoContext } from "../1-base/cuenta-demo.ts"

function tokenFalso() {
  const { enc, iv } = encryptSecret("token-de-mentira-solo-demo", EMAIL_PURPOSE)
  return { refreshTokenEnc: enc, refreshTokenIv: iv }
}

export async function seed({ prisma, userId }: DemoContext) {
  const bank = await prisma.bank.findFirstOrThrow({ where: { userId } })
  await prisma.bank.update({
    where: { id: bank.id },
    data: { provider: "bancochile", connectionMethod: "email", lastSyncedAt: new Date() },
  })
  const activo = await prisma.emailMailbox.create({
    data: { userId, emailProvider: "outlook", emailAddress: "finanzas.demo@outlook.com", status: "active", ...tokenFalso(), lastSyncedAt: new Date() },
  })
  await prisma.emailBankLink.create({
    data: { mailboxId: activo.id, userId, bankProvider: "bancochile", bankId: bank.id, status: "active", lastBalanceReconciledAt: new Date() },
  })
  await prisma.bankConnectionMethod.create({
    data: { userId, bankProvider: "bancochile", mailboxId: activo.id, method: "email" },
  })
  await prisma.emailMailbox.create({
    data: {
      userId, emailProvider: "outlook", emailAddress: "respaldo.demo@outlook.com", status: "reauth_required",
      ...tokenFalso(), lastError: "La autorización de Outlook expiró o fue revocada.",
    },
  })
}
