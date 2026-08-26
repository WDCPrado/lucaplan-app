// WDC-70 — la conexión por correo deja de dar Outlook por sentado: cada buzón guarda de qué
// proveedor es y la tarjeta del correo lo rotula.
//
// Eso solo se ve con un correo YA conectado, y en el entorno de PR no se puede conectar de verdad:
// el OAuth de Microsoft exige que la redirect URI esté registrada en Entra, y cada PR estrena
// subdominio. Así que la escena deja el buzón sembrado, con su vínculo al banco que el usuario ya
// trae.
//
// El refresh token es basura CIFRADA a propósito: sirve para que la fila exista y la vista se
// pueda revisar, no para hablar con Microsoft. Sincronizar o reconectar desde esta cuenta falla, y
// tiene que fallar — no hay autorización real detrás.

import { encryptSecret, EMAIL_PURPOSE } from "../../../arch/v1/infrastructure/crypto/secret-crypto.ts"
import type { EscenaContext } from "../sembrar-usuario.ts"

export const correo = "wdc-70@lucaplan.cl"
export const titulo = "WDC-70 — correo conectado con proveedor"

const BUZON = "finanzas.demo@outlook.com"

export async function seed({ prisma, userId }: EscenaContext) {
  // El banco del usuario sembrado es el que este correo "alimenta": no se crea otro.
  const bank = await prisma.bank.findFirst({ where: { userId } })
  if (!bank) throw new Error("el usuario sembrado no tiene banco")

  // Re-siembra: fuera el buzón anterior de ESTE usuario (el vínculo cae por cascada).
  await prisma.emailMailbox.deleteMany({ where: { userId } })

  const { enc, iv } = encryptSecret("token-de-mentira-solo-demo", EMAIL_PURPOSE)
  const mailbox = await prisma.emailMailbox.create({
    data: {
      userId,
      emailProvider: "outlook", // la columna que esta tarjeta empezó a respetar
      emailAddress: BUZON,
      status: "active",
      refreshTokenEnc: enc,
      refreshTokenIv: iv,
      lastSyncedAt: new Date(),
    },
  })

  await prisma.emailBankLink.create({
    data: {
      mailboxId: mailbox.id,
      userId,
      bankProvider: "bancochile",
      bankId: bank.id,
      status: "active",
      lastBalanceReconciledAt: new Date(),
    },
  })

  console.log(
    `[seed:pr] WDC-70: buzón ${BUZON} (outlook) conectado a "${bank.name}" — ` +
      `"Conectar banco" debe mostrar la tarjeta del correo con la etiqueta del proveedor.`
  )
}
