// Datos EXTRA del PR actual: lo que la feature de esta rama necesita para poder probarse y que el
// seed base (scripts/seed-pr.ts) no siembra. Lo corre el seed base al final de la primera siembra,
// con el usuario demo ya creado, y solo en entornos de PR de Railway.
//
// SE REESCRIBE COMPLETO EN CADA FEATURE, antes de abrir el PR. El contenido pertenece al PR en
// curso, no al repo: si tu cambio no necesita datos propios, déjalo como no-op.
//
// Reglas al escribirlo:
//   - Solo la data mínima de la feature y sus dependencias. Usuario, cuentas, categorías,
//     presupuesto, movimientos, recurrentes y planes de cuotas ya vienen del seed base: tómalos
//     del ctx en vez de crear otros.
//   - Nada de datos reales ni secretos: el entorno de PR es público.
//   - Si falla, el seed base lo registra y sigue (no tumba el deploy), pero la feature queda sin
//     datos. Pruébalo antes con `SEED_PR_FORCE=1 pnpm seed:pr` contra una base local.
//
// --- PR actual: Banco BICE, sobre el modelo multi-buzón y multi-banco ---
// Para revisar la pantalla de conexión hace falta ver los dos niveles llenos: correos y, dentro de
// cada uno, sus bancos. Se siembran DOS buzones: el personal con DOS bancos distintos (Banco de
// Chile y Banco BICE, que es lo que estrena este PR) y el de empresa con el mismo Banco de Chile
// bajo etiqueta, que es el caso del badge.
//
// Los tokens son basura deliberada: sirven para dibujar la UI, no para hablar con Microsoft. Tocar
// "Sincronizar ahora" con estos buzones falla (token inválido) — es lo esperado en el entorno de PR.
import type { FeatureSeedContext } from "./seed-pr.ts" // solo el tipo: no ejecuta el seed base

export default async function seedFeature({
  prisma,
  userId,
  checkingId,
  creditCardId,
}: FeatureSeedContext) {
  const asOf = new Date()

  // Instrumentos con últimos 4 y buckets, para que el banco conectado se vea como en producción.
  await prisma.financialAccount.update({
    where: { id: checkingId },
    data: { cardLast4: "8900", balance: 842350, provider: "bancochile" },
  })
  await prisma.balanceBucket.createMany({
    data: [
      {
        userId,
        accountId: checkingId,
        kind: "cash",
        currency: "CLP",
        limitAmount: 0,
        used: 0,
        available: 842350,
        asOf,
      },
      {
        userId,
        accountId: checkingId,
        kind: "overdraft",
        currency: "CLP",
        limitAmount: 1000000,
        used: 0,
        available: 1000000,
        asOf,
      },
    ],
  })
  await prisma.financialAccount.update({
    where: { id: creditCardId },
    data: {
      cardLast4: "2120",
      name: "Visa Signature",
      balance: -1900000,
      provider: "bancochile",
    },
  })

  // El banco del seed base pasa a ser el que alimenta el buzón personal.
  const personalBank = await prisma.financialAccount.findUnique({
    where: { id: checkingId },
    select: { bankId: true },
  })
  if (!personalBank) return

  const fakeToken = { refreshTokenEnc: "seed-pr", refreshTokenIv: "seed-pr" }

  const personal = await prisma.emailMailbox.create({
    data: {
      userId,
      emailAddress: "demo.personal@example.test",
      status: "active",
      lastSyncedAt: asOf,
      subscriptionId: "seed-pr-personal",
      subscriptionExpiresAt: new Date(asOf.getTime() + 3 * 24 * 3600 * 1000),
      ...fakeToken,
    },
  })
  await prisma.emailBankLink.create({
    data: {
      mailboxId: personal.id,
      userId,
      bankProvider: "bancochile",
      label: null, // único vínculo de este correo: sin etiqueta, se ve "Banco de Chile"
      bankId: personalBank.bankId,
      status: "active",
      skippedCount: 3,
      lastBalanceReconciledAt: asOf,
    },
  })
  await prisma.bankConnectionMethod.create({
    data: {
      userId,
      bankProvider: "bancochile",
      mailboxId: personal.id,
      method: "email",
    },
  })

  // Segundo correo con el MISMO banco: es lo que exige la etiqueta y lo que muestra el badge
  // ("Banco de Chile Empresa"). Su banco tiene cuentas propias, sin mezclarse con las del personal.
  const empresaBank = await prisma.bank.create({
    data: {
      userId,
      name: "Banco de Chile Empresa",
      provider: "bancochile",
      connectionMethod: "email",
      lastSyncedAt: asOf,
    },
  })
  const empresaAccount = await prisma.financialAccount.create({
    data: {
      userId,
      bankId: empresaBank.id,
      name: "Cuenta Corriente",
      accountType: "checking",
      currency: "CLP",
      balance: 2450000,
      cardLast4: "7412",
      provider: "bancochile",
      // La identidad externa lleva el banco: sin eso, dos cuentas con los mismos últimos 4
      // colisionarían en el unique (userId, externalId).
      externalId: "email:bancochile:acct:001234567412",
      lastSyncedAt: asOf,
    },
  })
  await prisma.balanceBucket.create({
    data: {
      userId,
      accountId: empresaAccount.id,
      kind: "cash",
      currency: "CLP",
      limitAmount: 0,
      used: 0,
      available: 2450000,
      asOf,
    },
  })
  const empresa = await prisma.emailMailbox.create({
    data: {
      userId,
      emailAddress: "demo.empresa@example.test",
      status: "active",
      lastSyncedAt: asOf,
      ...fakeToken,
    },
  })
  await prisma.emailBankLink.create({
    data: {
      mailboxId: empresa.id,
      userId,
      bankProvider: "bancochile",
      label: "Empresa",
      bankId: empresaBank.id,
      status: "active",
      skippedCount: 0,
      lastBalanceReconciledAt: asOf,
    },
  })
  await prisma.bankConnectionMethod.create({
    data: {
      userId,
      bankProvider: "bancochile",
      mailboxId: empresa.id,
      method: "email",
    },
  })

  // Banco BICE en el MISMO correo personal: dos bancos distintos bajo un buzón, cada uno con sus
  // cuentas. Sus correos no cuentan como omitidos del otro porque el enrutado es por remitente.
  const biceBank = await prisma.bank.create({
    data: {
      userId,
      name: "Banco BICE",
      provider: "bice",
      connectionMethod: "email",
      lastSyncedAt: asOf,
    },
  })
  const biceAccount = await prisma.financialAccount.create({
    data: {
      userId,
      bankId: biceBank.id,
      name: "Cuenta Corriente",
      accountType: "checking",
      currency: "CLP",
      balance: 318740,
      cardLast4: "5678",
      provider: "bice",
      externalId: "email:bice:acct:12345678",
      lastSyncedAt: asOf,
    },
  })
  await prisma.balanceBucket.create({
    data: {
      userId,
      accountId: biceAccount.id,
      kind: "cash",
      currency: "CLP",
      limitAmount: 0,
      used: 0,
      available: 318740,
      asOf,
    },
  })
  await prisma.emailBankLink.create({
    data: {
      mailboxId: personal.id,
      userId,
      bankProvider: "bice",
      label: null,
      bankId: biceBank.id,
      status: "active",
      skippedCount: 0,
      lastBalanceReconciledAt: asOf,
    },
  })
  await prisma.bankConnectionMethod.create({
    data: {
      userId,
      bankProvider: "bice",
      mailboxId: personal.id,
      method: "email",
    },
  })

  console.log(
    "[seed:pr] dos correos conectados: personal (Banco de Chile + Banco BICE) y empresa (Banco de Chile Empresa, con badge)."
  )
}
