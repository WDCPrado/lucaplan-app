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

  // Seed refrescante: borra los datos financieros del usuario y los recrea (cascade limpia
  // cuentas/transacciones y categorías). Así `pnpm seed` es re-ejecutable en dev.
  await prisma.transaction.deleteMany({ where: { userId: user.id } });
  await prisma.bank.deleteMany({ where: { userId: user.id } });
  await prisma.budget.deleteMany({ where: { userId: user.id } });

  const bank = await prisma.bank.create({ data: { userId: user.id, name: "Banco de Chile" } });

  const checking = await prisma.financialAccount.create({
    data: {
      userId: user.id,
      bankId: bank.id,
      name: "Cuenta corriente CLP",
      accountType: "checking",
      currency: "CLP",
      balance: 12965,
      overdraftLimit: 1000000,
      color: "#1e3a8a",
    },
  });
  await prisma.financialAccount.createMany({
    data: [
      { userId: user.id, bankId: bank.id, name: "TC nacional CLP", accountType: "credit_card", currency: "CLP", balance: -50000, color: "#334155" },
      { userId: user.id, bankId: bank.id, name: "TC internacional USD", accountType: "credit_card", currency: "USD", balance: 0, color: "#475569" },
    ],
  });

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const budget = await prisma.budget.create({
    data: { userId: user.id, name: `Presupuesto ${month}/${year}`, year, month },
  });
  const categoriesSeed: [string, number, string, string][] = [
    ["Cuentas", 920000, "🧾", "#f59e0b"],
    ["Invertir", 60000, "📈", "#22c55e"],
    ["Subscripciones", 100000, "🔁", "#8b5cf6"],
    ["Supermercado", 70000, "🛒", "#f59e0b"],
    ["Transporte", 50000, "🚌", "#38bdf8"],
    ["Viajes", 100000, "✈️", "#06b6d4"],
    ["Margen libre", 50000, "🟢", "#22c55e"],
    ["Compras", 470000, "🛍️", "#ec4899"],
  ];
  await prisma.category.createMany({
    data: categoriesSeed.map(([name, limitAmount, icon, color]) => ({ budgetId: budget.id, name, limitAmount, icon, color })),
  });
  const supermercado = await prisma.category.findFirstOrThrow({ where: { budgetId: budget.id, name: "Supermercado" } });

  const compras = await prisma.category.findFirstOrThrow({ where: { budgetId: budget.id, name: "Compras" } });
  await prisma.transaction.createMany({
    data: [
      { userId: user.id, accountId: checking.id, categoryId: supermercado.id, transactionDate: new Date(year, month - 1, 3), description: "Pago:unimarc Vitacura", amount: 6040, currency: "CLP", direction: "debit" },
      { userId: user.id, accountId: checking.id, categoryId: compras.id, transactionDate: new Date(year, month - 1, 5), description: "MERCADOPAGODUNKIN", amount: 6750, currency: "CLP", direction: "debit" },
      { userId: user.id, accountId: checking.id, categoryId: null, transactionDate: new Date(year, month - 1, 4), description: "Abono Segun Instruc.", amount: 17450, currency: "CLP", direction: "credit" },
      { userId: user.id, accountId: checking.id, categoryId: compras.id, transactionDate: new Date(year, month - 1, 6), description: "DL RAPPI CHILE RAPPI", amount: 13590, currency: "CLP", direction: "debit" },
    ],
  });

  console.log(`Seed OK para ${user.email}: banco + 3 cuentas + presupuesto "${budget.name}" (8 categorías) + 4 movimientos.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
