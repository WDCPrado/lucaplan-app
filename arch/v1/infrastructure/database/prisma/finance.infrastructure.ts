// Adapters Postgres del dominio finance. Implementan los ports mapeando Prisma Decimal ↔ Money.
// El dominio nunca ve tipos de Prisma. Los presupuestos/categorías se asumen en CLP (base).
import { prisma } from "./client.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import type {
  Account,
  AccountRepository,
  AccountType,
  BalanceBucket,
  BalanceBucketRepository,
  Bank,
  BankRepository,
  BucketKind,
  Category,
  CategoryLimit,
  CategoryRepository,
  CategoryType,
  Direction,
  MonthlyBudget,
  MonthlyBudgetRepository,
  MovementStatus,
  NewTransaction,
  Provider,
  Transaction,
  TransactionRepository,
  UpdateTransaction,
} from "../../../domain/finance/finance.domain.ts"

const BUDGET_CURRENCY: CurrencyCode = "CLP"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAccount(row: any): Account {
  const currency = row.currency as CurrencyCode
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
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCategory(row: any): Category {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    type: (row.type ?? "expense") as CategoryType,
    icon: row.icon ?? null,
    color: row.color ?? null,
    description: row.description ?? null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toLimit(row: any): CategoryLimit {
  return {
    id: row.id,
    categoryId: row.categoryId,
    year: row.year,
    month: row.month,
    limit: Money.of(row.limitAmount.toString(), BUDGET_CURRENCY),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTransaction(row: any): Transaction {
  const currency = row.currency as CurrencyCode
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
    isInternal: row.isInternal ?? false,
    externalId: row.externalId ?? null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toBank = (r: any): Bank => ({
  id: r.id,
  userId: r.userId,
  name: r.name,
  isActive: r.isActive,
  provider: (r.provider ?? "manual") as Provider,
  connectionMethod: r.connectionMethod ?? null,
  lastSyncedAt: r.lastSyncedAt ?? null,
})

export const bankRepository: BankRepository = {
  async listByUser(userId) {
    return (await prisma.bank.findMany({ where: { userId } })).map(toBank)
  },
  async create(input) {
    return toBank(
      await prisma.bank.create({
        data: { userId: input.userId, name: input.name },
      })
    )
  },
  async findById(id) {
    const row = await prisma.bank.findUnique({ where: { id } })
    return row ? toBank(row) : null
  },
  async delete(bankId) {
    // FK ON DELETE CASCADE: borrar el banco elimina sus cuentas y, con ellas, sus movimientos.
    await prisma.bank.delete({ where: { id: bankId } })
  },
}

export const accountRepository: AccountRepository = {
  async listByUser(userId) {
    return (await prisma.financialAccount.findMany({ where: { userId } })).map(
      toAccount
    )
  },
  async findById(id) {
    const row = await prisma.financialAccount.findUnique({ where: { id } })
    return row ? toAccount(row) : null
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
    })
    return toAccount(row)
  },
  async listByBank(bankId) {
    return (await prisma.financialAccount.findMany({ where: { bankId } })).map(
      toAccount
    )
  },
  async setBalance(accountId, balance) {
    await prisma.financialAccount.update({
      where: { id: accountId },
      data: { balance: balance.toDecimalString() },
    })
  },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toBucket(row: any): BalanceBucket {
  const currency = row.currency as CurrencyCode
  return {
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    cardId: row.cardId ?? null,
    kind: row.kind as BucketKind,
    currency,
    limitAmount: Money.of(row.limitAmount.toString(), currency),
    used: Money.of(row.used.toString(), currency),
    available: Money.of(row.available.toString(), currency),
    asOf: row.asOf ?? null,
  }
}

export const balanceBucketRepository: BalanceBucketRepository = {
  async listByUser(userId) {
    return (await prisma.balanceBucket.findMany({ where: { userId } })).map(
      toBucket
    )
  },
  async listByAccount(accountId) {
    return (await prisma.balanceBucket.findMany({ where: { accountId } })).map(
      toBucket
    )
  },
  async updateAmounts(bucketId, amounts) {
    await prisma.balanceBucket.update({
      where: { id: bucketId },
      data: {
        limitAmount: amounts.limitAmount.toDecimalString(),
        used: amounts.used.toDecimalString(),
        available: amounts.available.toDecimalString(),
        asOf: amounts.asOf,
      },
    })
  },
}

export const categoryRepository: CategoryRepository = {
  async listByUser(userId) {
    return (
      await prisma.category.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: "asc" },
      })
    ).map(toCategory)
  },
  async findById(id) {
    const row = await prisma.category.findUnique({ where: { id } })
    return row ? toCategory(row) : null
  },
  async upsert(input) {
    const data = {
      userId: input.userId,
      name: input.name,
      type: input.type,
      icon: input.icon,
      color: input.color,
      description: input.description,
    }
    const row = input.id
      ? await prisma.category.update({ where: { id: input.id }, data })
      : await prisma.category.create({ data })
    return toCategory(row)
  },
  async listLimitsByUser(userId) {
    return (
      await prisma.categoryLimit.findMany({ where: { category: { userId } } })
    ).map(toLimit)
  },
  async setLimit(input) {
    const row = await prisma.categoryLimit.upsert({
      where: {
        categoryId_year_month: {
          categoryId: input.categoryId,
          year: input.year,
          month: input.month,
        },
      },
      create: {
        categoryId: input.categoryId,
        year: input.year,
        month: input.month,
        limitAmount: input.limit.toDecimalString(),
      },
      update: { limitAmount: input.limit.toDecimalString() },
    })
    return toLimit(row)
  },
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMonthlyBudget(row: any): MonthlyBudget {
  return {
    id: row.id,
    userId: row.userId,
    year: row.year,
    month: row.month,
    globalLimit: Money.of(row.globalLimit.toString(), BUDGET_CURRENCY),
  }
}

export const monthlyBudgetRepository: MonthlyBudgetRepository = {
  async listByUser(userId) {
    return (await prisma.monthlyBudget.findMany({ where: { userId } })).map(
      toMonthlyBudget
    )
  },
  async set(input) {
    const row = await prisma.monthlyBudget.upsert({
      where: {
        userId_year_month: {
          userId: input.userId,
          year: input.year,
          month: input.month,
        },
      },
      create: {
        userId: input.userId,
        year: input.year,
        month: input.month,
        globalLimit: input.globalLimit.toDecimalString(),
      },
      update: { globalLimit: input.globalLimit.toDecimalString() },
    })
    return toMonthlyBudget(row)
  },
}

export const transactionRepository: TransactionRepository = {
  async listByUserPeriod(userId, year, month) {
    const rows = await prisma.transaction.findMany({
      where: { userId, ...periodWhere(year, month) },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
    })
    return rows.map(toTransaction)
  },
  async listByCategoryPeriod(categoryId, year, month) {
    const rows = await prisma.transaction.findMany({
      where: { categoryId, ...periodWhere(year, month) },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
    })
    return rows.map(toTransaction)
  },
  // Búsqueda con filtros combinados (AND). El texto matchea descripción o nombre de categoría,
  // case-insensitive. Devuelve los más recientes primero, acotado por `limit`.
  async searchByUser(userId, f) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { userId }
    if (f.direction) where.direction = f.direction
    if (f.categoryId) where.categoryId = f.categoryId
    // Filtra por banco (nombre): todas las cuentas de bancos con ese nombre, aunque haya varios.
    if (f.bankName) where.account = { bank: { name: f.bankName } }
    if (f.from || f.to)
      where.transactionDate = {
        ...(f.from ? { gte: f.from } : {}),
        ...(f.to ? { lte: f.to } : {}),
      }
    if (f.query) {
      where.OR = [
        { description: { contains: f.query, mode: "insensitive" } },
        { category: { name: { contains: f.query, mode: "insensitive" } } },
      ]
    }
    // Triage: el flag mete el criterio de elegibilidad COMPLETO al where (no post-filtrado),
    // para que el `take` no se consuma con filas inelegibles.
    if (f.uncategorized) {
      where.categoryId = null
      where.status = { notIn: ["reversed", "duplicated"] }
      where.isInternal = false
    }
    const rows = await prisma.transaction.findMany({
      where,
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      take: Math.min(Math.max(f.limit ?? 50, 1), 100),
    })
    return rows.map(toTransaction)
  },
  async findById(id) {
    const row = await prisma.transaction.findUnique({ where: { id } })
    return row ? toTransaction(row) : null
  },
  async create(tx: NewTransaction) {
    // Inserta el movimiento y ajusta el saldo de la cuenta atómicamente.
    const delta = tx.direction === "credit" ? tx.amount : tx.amount.negate()
    const row = await prisma.$transaction(async (db) => {
      const account = await db.financialAccount.findUniqueOrThrow({
        where: { id: tx.accountId },
      })
      const newBalance = Money.of(
        account.balance.toString(),
        account.currency as CurrencyCode
      ).add(delta)
      await db.financialAccount.update({
        where: { id: tx.accountId },
        data: { balance: newBalance.toDecimalString() },
      })
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
      })
    })
    return toTransaction(row)
  },
  // Edita un movimiento manual reajustando el saldo por la diferencia (nuevo − viejo), atómico.
  async update(input: UpdateTransaction) {
    const row = await prisma.$transaction(async (db) => {
      const old = await db.transaction.findUniqueOrThrow({
        where: { id: input.id },
      })
      const account = await db.financialAccount.findUniqueOrThrow({
        where: { id: old.accountId },
      })
      const currency = account.currency as CurrencyCode
      const oldMoney = Money.of(
        old.amount.toString(),
        old.currency as CurrencyCode
      )
      const oldDelta = old.direction === "credit" ? oldMoney : oldMoney.negate()
      const newDelta =
        input.direction === "credit" ? input.amount : input.amount.negate()
      const balance = Money.of(account.balance.toString(), currency)
        .add(newDelta)
        .subtract(oldDelta)
      await db.financialAccount.update({
        where: { id: account.id },
        data: { balance: balance.toDecimalString() },
      })
      return db.transaction.update({
        where: { id: input.id },
        data: {
          categoryId: input.categoryId,
          transactionDate: input.date,
          description: input.description,
          amount: input.amount.toDecimalString(),
          currency: input.amount.currency,
          direction: input.direction,
        },
      })
    })
    return toTransaction(row)
  },
  // Asigna/cambia solo la categoría (no toca el saldo; sirve para movimientos conectados).
  async setCategory(transactionId: string, categoryId: string | null) {
    return toTransaction(
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { categoryId },
      })
    )
  },
  // IA: escritura condicional atómica — el WHERE exige `categoryId IS NULL`, así la elección
  // manual concurrente del usuario nunca se sobrescribe.
  async setCategoryIfUncategorized(transactionId: string, categoryId: string) {
    const res = await prisma.transaction.updateMany({
      where: { id: transactionId, categoryId: null },
      data: { categoryId },
    })
    return res.count > 0
  },
  // Borra un movimiento manual revirtiendo su efecto en el saldo, atómico.
  async delete(transactionId: string) {
    await prisma.$transaction(async (db) => {
      const old = await db.transaction.findUniqueOrThrow({
        where: { id: transactionId },
      })
      const account = await db.financialAccount.findUniqueOrThrow({
        where: { id: old.accountId },
      })
      const currency = account.currency as CurrencyCode
      const oldMoney = Money.of(
        old.amount.toString(),
        old.currency as CurrencyCode
      )
      const oldDelta = old.direction === "credit" ? oldMoney : oldMoney.negate()
      const balance = Money.of(account.balance.toString(), currency).subtract(
        oldDelta
      )
      await db.financialAccount.update({
        where: { id: account.id },
        data: { balance: balance.toDecimalString() },
      })
      await db.transaction.delete({ where: { id: transactionId } })
    })
  },
}

// Filtro [primer día del mes, primer día del mes siguiente) sobre transactionDate.
function periodWhere(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))
  return { transactionDate: { gte: start, lt: end } }
}
