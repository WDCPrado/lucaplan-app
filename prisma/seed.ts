// Seed mínimo del caso Banco de Chile. Idempotente: si ya existe el banco para el
// usuario, no duplica. Corre con: pnpm seed  (o: node --env-file=.env prisma/seed.ts)
import { prisma } from "../arch/v1/infrastructure/database/prisma/client.ts";

async function main() {
  // Usa el primer usuario real; si no hay, crea uno demo (User no tiene FK desde finance).
  const user =
    (await prisma.user.findFirst()) ??
    (await prisma.user.create({
      data: { id: "demo-user", name: "Demo", email: "demo@lucaplan.cl", emailVerified: true },
    }));

  const existing = await prisma.bank.findFirst({ where: { userId: user.id, name: "Banco de Chile" } });
  if (existing) {
    console.log("Seed: 'Banco de Chile' ya existe para", user.email, "— nada que hacer.");
    return;
  }

  const bank = await prisma.bank.create({ data: { userId: user.id, name: "Banco de Chile" } });

  const checking = await prisma.financialAccount.create({
    data: {
      userId: user.id,
      bankId: bank.id,
      name: "Cuenta corriente CLP",
      accountType: "checking",
      currency: "CLP",
      balance: 19005,
      overdraftLimit: 1000000,
    },
  });
  await prisma.financialAccount.createMany({
    data: [
      { userId: user.id, bankId: bank.id, name: "TC nacional CLP", accountType: "credit_card", currency: "CLP", balance: 0 },
      { userId: user.id, bankId: bank.id, name: "TC internacional USD", accountType: "credit_card", currency: "USD", balance: 0 },
    ],
  });

  const budget = await prisma.budget.create({
    data: { userId: user.id, name: "Enero 2026", year: 2026, month: 1 },
  });
  const categoriesSeed: [string, number][] = [
    ["Cuentas", 920000],
    ["Invertir", 60000],
    ["Subscripciones", 100000],
    ["Supermercado", 70000],
    ["Transporte", 50000],
    ["Viajes", 100000],
    ["Margen libre", 50000],
    ["Compras", 450000],
  ];
  await prisma.category.createMany({
    data: categoriesSeed.map(([name, limitAmount]) => ({ budgetId: budget.id, name, limitAmount })),
  });
  const supermercado = await prisma.category.findFirstOrThrow({ where: { budgetId: budget.id, name: "Supermercado" } });

  await prisma.transaction.createMany({
    data: [
      { userId: user.id, accountId: checking.id, categoryId: supermercado.id, transactionDate: new Date(2026, 0, 3), description: "Jumbo", amount: 30000, currency: "CLP", direction: "debit" },
      { userId: user.id, accountId: checking.id, categoryId: supermercado.id, transactionDate: new Date(2026, 0, 9), description: "Lider", amount: 15000, currency: "CLP", direction: "debit" },
    ],
  });

  console.log(`Seed OK para ${user.email}: banco + 3 cuentas + presupuesto "Enero 2026" (8 categorías) + 2 movimientos.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
