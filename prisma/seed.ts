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

  // Seed refrescante: borra los datos financieros del usuario y los recrea. Re-ejecutable en dev.
  await prisma.transaction.deleteMany({ where: { userId: user.id } });
  await prisma.category.deleteMany({ where: { userId: user.id } }); // cascade borra sus límites
  await prisma.bank.deleteMany({ where: { userId: user.id } });

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
  const categoriesSeed: [string, number, string, string][] = [
    ["Cuentas", 920000, "Receipt", "#f59e0b"],
    ["Invertir", 60000, "TrendingUp", "#22c55e"],
    ["Subscripciones", 100000, "CreditCard", "#8b5cf6"],
    ["Supermercado", 70000, "ShoppingCart", "#f59e0b"],
    ["Transporte", 50000, "Bus", "#38bdf8"],
    ["Viajes", 100000, "Plane", "#06b6d4"],
    ["Margen libre", 50000, "Wallet", "#22c55e"],
    ["Compras", 470000, "ShoppingBag", "#ec4899"],
  ];
  // Categorías globales + su límite para el mes actual.
  const byName = new Map<string, string>();
  for (const [name, limitAmount, icon, color] of categoriesSeed) {
    const cat = await prisma.category.create({ data: { userId: user.id, name, icon, color } });
    await prisma.categoryLimit.create({ data: { categoryId: cat.id, year, month, limitAmount } });
    byName.set(name, cat.id);
  }
  const supermercado = { id: byName.get("Supermercado")! };
  const compras = { id: byName.get("Compras")! };
  await prisma.transaction.createMany({
    data: [
      { userId: user.id, accountId: checking.id, categoryId: supermercado.id, transactionDate: new Date(year, month - 1, 3), description: "Pago:unimarc Vitacura", amount: 6040, currency: "CLP", direction: "debit" },
      { userId: user.id, accountId: checking.id, categoryId: compras.id, transactionDate: new Date(year, month - 1, 5), description: "MERCADOPAGODUNKIN", amount: 6750, currency: "CLP", direction: "debit" },
      { userId: user.id, accountId: checking.id, categoryId: null, transactionDate: new Date(year, month - 1, 4), description: "Abono Segun Instruc.", amount: 17450, currency: "CLP", direction: "credit" },
      { userId: user.id, accountId: checking.id, categoryId: compras.id, transactionDate: new Date(year, month - 1, 6), description: "DL RAPPI CHILE RAPPI", amount: 13590, currency: "CLP", direction: "debit" },
    ],
  });

  console.log(`Seed OK para ${user.email}: banco + 3 cuentas + 8 categorías (límites ${month}/${year}) + 4 movimientos.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
