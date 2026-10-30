// WDC-70 — la conexión por correo deja de dar Outlook por sentado: cada buzón guarda de qué
// proveedor es y la tarjeta del correo lo rotula.
//
// Eso solo se ve con correos YA conectados, y en el entorno de PR no se puede conectar de verdad:
// el OAuth de Microsoft exige que la redirect URI esté registrada en Entra, y cada PR estrena
// subdominio. Así que la escena deja los buzones sembrados.
//
// Siembra DOS, porque son dos vistas distintas:
//   1. uno activo, con el banco del usuario, para ver la etiqueta del proveedor;
//   2. uno en `reauth_required`, que es el único estado donde aparece "Reconectar este correo" —
//      el botón que estrena el argumento nuevo (reconectar usa el proveedor DEL BUZÓN).
//
// El refresh token es basura CIFRADA a propósito: sirve para que la fila exista y la vista se
// pueda revisar, no para hablar con Microsoft. Sincronizar o reconectar desde estas cuentas falla,
// y tiene que fallar — no hay autorización real detrás.

import {
  encryptSecret,
  EMAIL_PURPOSE,
} from "../../../arch/v1/infrastructure/crypto/secret-crypto.ts"
import type { EscenaContext } from "../sembrar-usuario.ts"

export const correo = "wdc-70@lucaplan.cl"
export const titulo = "WDC-70 — correo conectado con proveedor"

const BUZON_ACTIVO = "finanzas.demo@outlook.com"
const BUZON_CADUCADO = "respaldo.demo@outlook.com"

// Token de mentira, cifrado como el real: la fila necesita ambas columnas para ser válida.
function tokenFalso() {
  const { enc, iv } = encryptSecret("token-de-mentira-solo-demo", EMAIL_PURPOSE)
  return { refreshTokenEnc: enc, refreshTokenIv: iv }
}

export async function seed({ prisma, userId }: EscenaContext) {
  const bank = await prisma.bank.findFirst({ where: { userId } })
  if (!bank) throw new Error("el usuario sembrado no tiene banco")

  // Re-siembra: fuera lo anterior de ESTE usuario (los vínculos caen por cascada del buzón).
  await prisma.emailMailbox.deleteMany({ where: { userId } })
  await prisma.bankConnectionMethod.deleteMany({ where: { userId } })

  // El banco del usuario base nace manual (`provider: "manual"`, `connectionMethod: null`). Una
  // conexión real lo deja marcado como conectado por correo, y de ahí sale el `connectionMethod`
  // de sus cuentas: sin esto el dashboard lo muestra manual, la actualización de saldos por el
  // plugin MCP no encuentra sus cuentas y la demo miente sobre el estado que viene a demostrar.
  await prisma.bank.update({
    where: { id: bank.id },
    data: {
      provider: "bancochile",
      connectionMethod: "email",
      lastSyncedAt: new Date(),
    },
  })

  const activo = await prisma.emailMailbox.create({
    data: {
      userId,
      emailProvider: "outlook", // la columna que esta tarjeta empezó a respetar
      emailAddress: BUZON_ACTIVO,
      status: "active",
      ...tokenFalso(),
      lastSyncedAt: new Date(),
    },
  })

  await prisma.emailBankLink.create({
    data: {
      mailboxId: activo.id,
      userId,
      bankProvider: "bancochile",
      bankId: bank.id,
      status: "active",
      lastBalanceReconciledAt: new Date(),
    },
  })

  // La fila que una conexión real reclama al conectar; sin ella el modelo queda a medias y
  // desconectar no encontraría qué liberar.
  await prisma.bankConnectionMethod.create({
    data: {
      userId,
      bankProvider: "bancochile",
      mailboxId: activo.id,
      method: "email",
    },
  })

  // Segundo buzón, sin bancos y con la autorización caída: así se ve el camino de reconexión.
  await prisma.emailMailbox.create({
    data: {
      userId,
      emailProvider: "outlook",
      emailAddress: BUZON_CADUCADO,
      status: "reauth_required",
      ...tokenFalso(),
      lastError: "La autorización de Outlook expiró o fue revocada.",
    },
  })

  console.log(
    `[seed:pr] WDC-70: ${BUZON_ACTIVO} (outlook) conectado a "${bank.name}" y ` +
      `${BUZON_CADUCADO} en reauth_required — "Conectar banco" debe mostrar las dos tarjetas ` +
      `con su etiqueta de proveedor, y la segunda con "Reconectar este correo".`
  )
}
