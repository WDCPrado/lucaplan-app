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
  Budget,
  BudgetInput,
  BudgetRepository,
  Category,
  CategoryInput,
  CategoryRepository,
  Direction,
  NewTransaction,
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
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCategory(row: any): Category {
  return {
    id: row.id,
    budgetId: row.budgetId,
    name: row.name,
    limit: Money.of(row.limitAmount.toString(), BUDGET_CURRENCY),
    icon: row.icon ?? null,
    color: row.color ?? null,
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
  };
}

const toBank = (r: { id: string; userId: string; name: string; isActive: boolean }): Bank => ({
  id: r.id,
  userId: r.userId,
  name: r.name,
  isActive: r.isActive,
});

export const bankRepository: BankRepository = {
  async listByUser(userId) {
    return (await prisma.bank.findMany({ where: { userId } })).map(toBank);
  },
  async create(input) {
    return toBank(await prisma.bank.create({ data: { userId: input.userId, name: input.name } }));
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
      },
    });
    return toAccount(row);
  },
};

export const budgetRepository: BudgetRepository = {
  async findById(id) {
    const row = await prisma.budget.findUnique({ where: { id } });
    return row ? { id: row.id, userId: row.userId, name: row.name, year: row.year, month: row.month } : null;
  },
  async findByUserMonth(userId, year, month) {
    const row = await prisma.budget.findFirst({ where: { userId, year, month } });
    return row ? { id: row.id, userId: row.userId, name: row.name, year: row.year, month: row.month } : null;
  },
  async listCategories(budgetId) {
    return (await prisma.category.findMany({ where: { budgetId } })).map(toCategory);
  },
  async upsertBudget(input: BudgetInput) {
    const data = { userId: input.userId, name: input.name, year: input.year, month: input.month };
    const row = input.id
      ? await prisma.budget.update({ where: { id: input.id }, data })
      : await prisma.budget.create({ data });
    return { id: row.id, userId: row.userId, name: row.name, year: row.year, month: row.month };
  },
  async upsertCategory(input: CategoryInput) {
    const data = {
      budgetId: input.budgetId,
      name: input.name,
      limitAmount: input.limit.toDecimalString(),
      icon: input.icon,
      color: input.color,
    };
    const row = input.id
      ? await prisma.category.update({ where: { id: input.id }, data })
      : await prisma.category.create({ data });
    return toCategory(row);
  },
};

export const categoryRepository: CategoryRepository = {
  async findById(id) {
    const row = await prisma.category.findUnique({ where: { id } });
    return row ? toCategory(row) : null;
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
};

// Filtro [primer día del mes, primer día del mes siguiente) sobre transactionDate.
function periodWhere(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { transactionDate: { gte: start, lt: end } };
}
