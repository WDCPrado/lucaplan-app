// WDC-80 — Actualizar los saldos de un banco por correo (hoy la tool MCP
// `lucaplan_reconciliar_saldos_correo`; antes un botón de la app) empareja la cuenta indicada con
// la real comparando los dígitos por sufijo. Una cuenta creada A MANO no tiene `externalId`, así que su referencia queda
// vacía — y `"1100".endsWith("")` es true, o sea que calzaba con CUALQUIER número que se escribiera
// y se llevaba el saldo de otra cuenta.
//
// Esa es la única de las tres puertas del bug que se alcanza desde afuera: la referencia vacía la
// rechaza antes el parseo de la entrada. Por eso la escena siembra justo esto —
// dos cuentas corrientes en el mismo banco conectado por correo:
//
//   1. la IMPOSTORA, creada a mano y sin número (`externalId` null);
//   2. la REAL, con su número de cuenta, que es la que debe recibir el saldo.
//
// Escribiendo `1100` en el formulario, el saldo tiene que caer en la REAL. Antes del fix caía en la
// impostora, que ni siquiera tiene ese número.
//
// El resultado NO depende de en qué orden las devuelva la base (`listInstruments` consulta sin
// `orderBy`): tras el fix solo una de las dos puede calzar con `1100`. Lo único que sí depende del
// orden es qué número aparece precargado en el formulario, y por eso el guion de prueba dice que
// se borre y se escriba el número a mano.
//
// El buzón va sembrado porque en el entorno de PR no se puede conectar de verdad: el OAuth de
// Microsoft exige que la redirect URI esté registrada en Entra y cada PR estrena subdominio. El
// refresh token es basura CIFRADA a propósito — sirve para que la fila exista y la pantalla se
// pueda abrir, no para hablar con Microsoft. Sincronizar desde esta cuenta falla, y tiene que
// fallar.

import {
  encryptSecret,
  EMAIL_PURPOSE,
} from "../../../arch/v1/infrastructure/crypto/secret-crypto.ts"
import type { EscenaContext } from "../sembrar-usuario.ts"

export const correo = "wdc-80@lucaplan.cl"
export const titulo = "WDC-80 — cuenta sin número intercepta saldos"

const BUZON = "saldos.demo@outlook.com"

// El número de cuenta de la cuenta REAL. El formulario se empareja por los últimos 4: `1100`.
const NUMERO_REAL = "009991111100"
const EXTERNAL_ID_REAL = `email:bancochile:acct:${NUMERO_REAL}`

// Montos fijos y distintos entre sí: son los que van escritos en el guion de prueba.
const SALDO_IMPOSTORA = 111111
const SALDO_REAL = 222222

function tokenFalso() {
  const { enc, iv } = encryptSecret("token-de-mentira-solo-demo", EMAIL_PURPOSE)
  return { refreshTokenEnc: enc, refreshTokenIv: iv }
}

export async function seed({ prisma, userId, checkingId }: EscenaContext) {
  const bank = await prisma.bank.findFirst({ where: { userId } })
  if (!bank) throw new Error("el usuario sembrado no tiene banco")

  // Re-siembra: fuera lo anterior de ESTE usuario (los vínculos caen por cascada del buzón).
  await prisma.emailMailbox.deleteMany({ where: { userId } })
  await prisma.bankConnectionMethod.deleteMany({ where: { userId } })
  await prisma.financialAccount.deleteMany({
    where: { userId, externalId: EXTERNAL_ID_REAL },
  })

  // El banco nace manual; una conexión real lo deja marcado como conectado por correo. Sin esto,
  // el banco no figura conectado por correo y no hay nada que probar.
  await prisma.bank.update({
    where: { id: bank.id },
    data: {
      provider: "bancochile",
      connectionMethod: "email",
      lastSyncedAt: new Date(),
    },
  })

  // (1) La impostora: la cuenta que el usuario base ya trae, creada a mano y por lo tanto SIN
  // `externalId`. Se renombra para que en el dashboard se vea cuál es cuál.
  await prisma.financialAccount.update({
    where: { id: checkingId },
    data: {
      name: "Cuenta corriente antigua (sin número)",
      balance: SALDO_IMPOSTORA,
    },
  })

  // El usuario base solo trae buckets para la tarjeta de crédito, así que esta cuenta llegaba sin
  // `cash` — y sin él las dos corrientes no se pueden comparar: el formulario y el dashboard leen
  // el `available` del bucket, no el `balance`. Se lo damos para que el "antes" se vea donde el
  // guion de prueba dice que se ve.
  await prisma.balanceBucket.deleteMany({
    where: { userId, accountId: checkingId, kind: "cash" },
  })
  await prisma.balanceBucket.create({
    data: {
      userId,
      accountId: checkingId,
      kind: "cash",
      currency: "CLP",
      limitAmount: 0,
      used: 0,
      available: SALDO_IMPOSTORA,
      asOf: new Date(),
    },
  })

  // (2) La real: la que sí trae número de cuenta, como la deja una conexión por correo.
  const real = await prisma.financialAccount.create({
    data: {
      userId,
      bankId: bank.id,
      name: "Cuenta corriente Banco de Chile",
      accountType: "checking",
      currency: "CLP",
      balance: SALDO_REAL,
      overdraftLimit: 0,
      cardLast4: NUMERO_REAL.slice(-4),
      color: "#1e3a8a",
      provider: "bancochile",
      externalId: EXTERNAL_ID_REAL,
    },
  })

  // El bucket de caja es lo que `lucaplan_reconciliar_saldos_correo` reescribe; sin él solo cambiaría el balance.
  await prisma.balanceBucket.create({
    data: {
      userId,
      accountId: real.id,
      kind: "cash",
      currency: "CLP",
      limitAmount: 0,
      used: 0,
      available: SALDO_REAL,
      asOf: new Date(),
    },
  })

  const buzon = await prisma.emailMailbox.create({
    data: {
      userId,
      emailProvider: "outlook",
      emailAddress: BUZON,
      status: "active",
      ...tokenFalso(),
      lastSyncedAt: new Date(),
    },
  })

  await prisma.emailBankLink.create({
    data: {
      mailboxId: buzon.id,
      userId,
      bankProvider: "bancochile",
      bankId: bank.id,
      status: "active",
      lastBalanceReconciledAt: new Date(),
    },
  })

  // La fila que una conexión real reclama al conectar; sin ella el modelo queda a medias.
  await prisma.bankConnectionMethod.create({
    data: {
      userId,
      bankProvider: "bancochile",
      mailboxId: buzon.id,
      method: "email",
    },
  })

  console.log(
    `[seed:pr] WDC-80: "${bank.name}" conectado por correo con DOS cuentas corrientes — ` +
      `la antigua sin número en $${SALDO_IMPOSTORA} y la real (…${NUMERO_REAL.slice(-4)}) en ` +
      `$${SALDO_REAL}. Con lucaplan_reconciliar_saldos_correo (plugin MCP), el número 1100 debe escribirle a la REAL.`
  )
}
