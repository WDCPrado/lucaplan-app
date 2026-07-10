// Adapters Postgres del dominio finance. Implementan los ports mapeando Prisma Decimal ↔ Money.
// El dominio nunca ve tipos de Prisma. Los presupuestos/categorías se asumen en CLP (base).
import { prisma } from "./client.ts";
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts";
import type {
  Account,
  AccountRepository,
  AccountType,
  Bank,
  BankRepository,
  Category,
  CategoryLimit,
  CategoryRepository,
  ConnectedAccountInput,
  ConnectedBankInput,
  Direction,
  ImportMovement,
  MovementStatus,
  NewTransaction,
  Provider,
  Transaction,
  TransactionRepository,
} from "../../../domain/finance/finance.domain.ts";

const BUDGET_CURRENCY: CurrencyCode = "CLP";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAccount(row: any): Account {
  const currency = row.currency as CurrencyCode;
  return {
    id: row.id,
    userId: row.userId,
    bankId: row.bankId,
    name: row.name,
    accountType: row.accountType as AccountType,
    currency,
    balance: Money.of(row.balance.toString(), currency),
    overdraftLimit: Money.of(row.overdraftLimit.toString(), currency),
    color: row.color ?? null,
    cardLast4: row.cardLast4 ?? null,
    provider: (row.provider ?? "manual") as Provider,
    externalId: row.externalId ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCategory(row: any): Category {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    icon: row.icon ?? null,
    color: row.color ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toLimit(row: any): CategoryLimit {
  return {
    id: row.id,
    categoryId: row.categoryId,
    year: row.year,
    month: row.month,
    limit: Money.of(row.limitAmount.toString(), BUDGET_CURRENCY),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTransaction(row: any): Transaction {
  const currency = row.currency as CurrencyCode;
  return {
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    categoryId: row.categoryId ?? null,
    date: row.transactionDate,
    description: row.description,
    amount: Money.of(row.amount.toString(), currency),
    direction: row.direction as Direction,
    status: (row.status ?? "confirmed") as MovementStatus,
    externalId: row.externalId ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toBank = (r: any): Bank => ({
  id: r.id,
  userId: r.userId,
  name: r.name,
  isActive: r.isActive,
  provider: (r.provider ?? "manual") as Provider,
  externalLinkId: r.externalLinkId ?? null,
  linkToken: r.linkToken ?? null,
  lastSyncedAt: r.lastSyncedAt ?? null,
});

export const bankRepository: BankRepository = {
  async listByUser(userId) {
    return (await prisma.bank.findMany({ where: { userId } })).map(toBank);
  },
  async create(input) {
    return toBank(await prisma.bank.create({ data: { userId: input.userId, name: input.name } }));
  },
  async findById(id) {
    const row = await prisma.bank.findUnique({ where: { id } });
    return row ? toBank(row) : null;
  },
  async findByExternalLinkId(externalLinkId) {
    const row = await prisma.bank.findFirst({ where: { externalLinkId } });
    return row ? toBank(row) : null;
  },
  async upsertConnected(input: ConnectedBankInput) {
    const existing = await prisma.bank.findFirst({
      where: { userId: input.userId, externalLinkId: input.externalLinkId },
    });
    const data = {
      name: input.name,
      provider: "fintoc",
      externalLinkId: input.externalLinkId,
      linkToken: input.linkToken,
      lastSyncedAt: new Date(),
    };
    const row = existing
      ? await prisma.bank.update({ where: { id: existing.id }, data })
      : await prisma.bank.create({ data: { userId: input.userId, ...data } });
    return toBank(row);
  },
};

export const accountRepository: AccountRepository = {
  async listByUser(userId) {
    return (await prisma.financialAccount.findMany({ where: { userId } })).map(toAccount);
  },
  async findById(id) {
    const row = await prisma.financialAccount.findUnique({ where: { id } });
    return row ? toAccount(row) : null;
  },
  async create(input) {
    const row = await prisma.financialAccount.create({
      data: {
        userId: input.userId,
        bankId: input.bankId,
        name: input.name,
        accountType: input.accountType,
        currency: input.currency,
        balance: input.balance.toDecimalString(),
        overdraftLimit: input.overdraftLimit.toDecimalString(),
        color: input.color,
        cardLast4: input.cardLast4,
      },
    });
    return toAccount(row);
  },
  async listByBank(bankId) {
    return (await prisma.financialAccount.findMany({ where: { bankId } })).map(toAccount);
  },
  async upsertConnected(input: ConnectedAccountInput) {
    const existing = await prisma.financialAccount.findFirst({
      where: { userId: input.userId, externalId: input.externalId },
    });
    const data = {
      bankId: input.bankId,
      name: input.name,
      accountType: input.accountType,
      currency: input.currency,
      balance: input.balance.toDecimalString(), // saldo del proveedor (se sobrescribe cada sync)
      overdraftLimit: input.overdraftLimit.toDecimalString(),
      cardLast4: input.cardLast4,
      provider: "fintoc",
      lastSyncedAt: new Date(),
    };
    const row = existing
      ? await prisma.financialAccount.update({ where: { id: existing.id }, data })
      : await prisma.financialAccount.create({ data: { userId: input.userId, externalId: input.externalId, ...data } });
    return toAccount(row);
  },
};

export const categoryRepository: CategoryRepository = {
  async listByUser(userId) {
    return (await prisma.category.findMany({ where: { userId, isActive: true }, orderBy: { createdAt: "asc" } })).map(toCategory);
  },
  async findById(id) {
    const row = await prisma.category.findUnique({ where: { id } });
    return row ? toCategory(row) : null;
  },
  async upsert(input) {
    const data = { userId: input.userId, name: input.name, icon: input.icon, color: input.color };
    const row = input.id
      ? await prisma.category.update({ where: { id: input.id }, data })
      : await prisma.category.create({ data });
    return toCategory(row);
  },
  async listLimitsByUser(userId) {
    return (await prisma.categoryLimit.findMany({ where: { category: { userId } } })).map(toLimit);
  },
  async setLimit(input) {
    const row = await prisma.categoryLimit.upsert({
      where: { categoryId_year_month: { categoryId: input.categoryId, year: input.year, month: input.month } },
      create: { categoryId: input.categoryId, year: input.year, month: input.month, limitAmount: input.limit.toDecimalString() },
      update: { limitAmount: input.limit.toDecimalString() },
    });
    return toLimit(row);
  },
};

export const transactionRepository: TransactionRepository = {
  async listByUserPeriod(userId, year, month) {
    const rows = await prisma.transaction.findMany({
      where: { userId, ...periodWhere(year, month) },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
    });
    return rows.map(toTransaction);
  },
  async listByCategoryPeriod(categoryId, year, month) {
    const rows = await prisma.transaction.findMany({
      where: { categoryId, ...periodWhere(year, month) },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
    });
    return rows.map(toTransaction);
  },
  async create(tx: NewTransaction) {
    // Inserta el movimiento y ajusta el saldo de la cuenta atómicamente.
    const delta = tx.direction === "credit" ? tx.amount : tx.amount.negate();
    const row = await prisma.$transaction(async (db) => {
      const account = await db.financialAccount.findUniqueOrThrow({ where: { id: tx.accountId } });
      const newBalance = Money.of(account.balance.toString(), account.currency as CurrencyCode).add(delta);
      await db.financialAccount.update({ where: { id: tx.accountId }, data: { balance: newBalance.toDecimalString() } });
      return db.transaction.create({
        data: {
          userId: tx.userId,
          accountId: tx.accountId,
          categoryId: tx.categoryId,
          transactionDate: tx.date,
          description: tx.description,
          amount: tx.amount.toDecimalString(),
          currency: tx.amount.currency,
          direction: tx.direction,
        },
      });
    });
    return toTransaction(row);
  },
  // Import idempotente de movimientos de Fintoc: upsert por (accountId, externalId), preserva
  // categoryId (no se toca en update) y NO ajusta el saldo (lo fija el proveedor).
  // ponytail: upsert secuencial; batch si el volumen lo pide.
  async importMovements(userId: string, accountId: string, movements: ImportMovement[]) {
    const CHUNK = 10; // ponytail: upsert en lotes acotados (evita saturar el pool de conexiones).
    for (let i = 0; i < movements.length; i += CHUNK) {
      await Promise.all(
        movements.slice(i, i + CHUNK).map((m) => {
          const fields = {
            transactionDate: m.date,
            description: m.description,
            amount: m.amount.toDecimalString(),
            currency: m.amount.currency,
            direction: m.direction,
            status: m.status,
            pending: m.status === "pending",
          };
          return prisma.transaction.upsert({
            where: { accountId_externalId: { accountId, externalId: m.externalId } },
            create: { userId, accountId, externalId: m.externalId, ...fields },
            update: fields, // categoryId intacto → categoría preservada
          });
        }),
      );
    }
  },
};

// Filtro [primer día del mes, primer día del mes siguiente) sobre transactionDate.
function periodWhere(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { transactionDate: { gte: start, lt: end } };
}
