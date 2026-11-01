// Real PostgreSQL integration. Explicit disposable local DB; never accepts DATABASE_URL.
import assert from "node:assert/strict"
const url = new URL(process.env.REIMBURSEMENT_TEST_DATABASE_URL ?? "http://missing")
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/reimbursement_test")
  throw new Error("REIMBURSEMENT_TEST_DATABASE_URL debe apuntar a la base local aislada reimbursement_test")
process.env.DATABASE_URL = url.toString()
const { prisma } = await import("../arch/v1/infrastructure/database/prisma/client.ts")
const { linkReimbursement, normalizeManualReimbursements, reimbursementTransaction } = await import("../arch/v1/infrastructure/database/prisma/reimbursement.infrastructure.ts")
const { accountRepository, bankRepository, categoryRepository, monthlyBudgetRepository, transactionRepository } = await import("../arch/v1/infrastructure/database/prisma/finance.infrastructure.ts")
const { reimbursementReadRepository } = await import("../arch/v1/infrastructure/database/prisma/reimbursement-read.infrastructure.ts")
const { budgetPeriodRepository } = await import("../arch/v1/infrastructure/database/prisma/budget-period.infrastructure.ts")
const { getBudgetView } = await import("../arch/v1/application/finance-use-cases/finance-read.ts")
const { Money } = await import("../arch/v1/domain/finance/money.ts")
const userId = `refund-test-${crypto.randomUUID()}`
const deps = { accounts: accountRepository, banks: bankRepository, categories: categoryRepository,
  monthlyBudgets: monthlyBudgetRepository, transactions: transactionRepository, reimbursements: reimbursementReadRepository,
  budgetPeriod: budgetPeriodRepository, exchangeRates: { clpPerUsdAt: async () => 950 } }
const view = (mode: "calendar" | "card_cycle", year = 2026, month = 11) => {
  const scoped = { ...deps, periodSettings: { mode, overrides: {} } }
  return getBudgetView(scoped, userId, year, month)
}
let bankId: string | undefined
try {
  assert.equal(await prisma.bank.count(), 0, "use a disposable empty database")
  const bank = await prisma.bank.create({ data: { userId, name: "Refund QA" } }); bankId = bank.id
  const account = await prisma.financialAccount.create({ data: { userId, bankId, name: "Demo", accountType: "checking", currency: "CLP", balance: 700000 } })
  const category = await prisma.category.create({ data: { userId, name: "Compras demo", type: "expense" } })
  const other = await prisma.category.create({ data: { userId, name: "Comida demo", type: "expense" } })
  const income = await prisma.category.create({ data: { userId, name: "Abono de terceros demo", type: "income" } })
  const movement = (id: string, amount: number, direction = "debit", categoryId: string | null = category.id, date = "2026-10-31") => prisma.transaction.create({ data: {
    id: `${userId}-${id}`, userId, accountId: account.id, categoryId, transactionDate: new Date(date), description: id,
    amount, currency: "CLP", direction, status: "confirmed",
  } })
  for (const mode of ["calendar", "card_cycle"])
    await prisma.categoryLimit.create({ data: { categoryId: category.id, mode, year: 2026, month: 9, limitAmount: 100000 } })
  await prisma.categoryLimit.create({ data: { categoryId: category.id, mode: "card_cycle", year: 2026, month: 12, limitAmount: 90000 } })
  await prisma.monthlyBudget.create({ data: { userId, mode: "card_cycle", year: 2026, month: 9, globalLimit: 100000 } })
  await budgetPeriodRepository.setMode("card_cycle")
  const expense = await movement("expense", 60000)
  const credit = await movement("credit", 20000, "credit", income.id, "2026-11-01")
  const linkInput = { expenseId: expense.id, creditId: credit.id, amount: 20000 }
  const first = await linkReimbursement(userId, linkInput)
  assert.equal(first.created, true)
  let budget = await view("card_cycle")
  assert.equal(budget.categories.find(c => c.id === category.id)?.limit, 120000)
  assert.equal(budget.spent, 60000)
  assert.equal(budget.categories.find(c => c.id === category.id)?.available, 60000)
  assert.equal(budget.reimbursementAdjustment, 0)
  assert.equal(budget.income, 20000)
  assert.equal(budget.globalLimit, 100000)
  assert.equal(budget.remainingToAllocate, -20000)
  assert.equal((await view("card_cycle", 2026, 12)).allocated, 90000)
  assert.equal((await view("card_cycle", 2027, 1)).allocated, 90000)
  assert.equal((await view("calendar", 2026, 10)).allocated, 100000)
  assert.equal((await view("calendar", 2026, 10)).spent, 40000, "other mode keeps legacy semantics until explicitly adjusted")
  assert.equal((await linkReimbursement(userId, linkInput)).created, false)
  await assert.rejects(linkReimbursement(userId, { ...linkInput, amount: 10000 }), /otro importe/)
  await assert.rejects(linkReimbursement("other-user", linkInput), /no pertenece/)
  assert.equal(await prisma.expenseReimbursement.count({ where: { userId } }), 1)
  assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: credit.id } })).categoryId, income.id)
  assert.equal(Number((await prisma.financialAccount.findUniqueOrThrow({ where: { id: account.id } })).balance), 700000)

  // Effective-cap edits don't absorb the supplement into future months or apply it twice.
  await categoryRepository.setLimit({ categoryId: category.id, mode: "card_cycle", year: 2026, month: 11, limit: Money.of(130000, "CLP") })
  assert.equal((await view("card_cycle")).allocated, 130000)
  await assert.rejects(categoryRepository.setLimit({ categoryId: category.id, mode: "card_cycle", year: 2026, month: 11, limit: Money.of(10000, "CLP") }), /suplemento/)
  assert.equal((await view("card_cycle", 2026, 12)).allocated, 90000)

  // Automatic supplements move atomically with the expense category; gross amount stays real.
  await transactionRepository.setCategory(expense.id, other.id)
  budget = await view("card_cycle")
  assert.equal(budget.categories.find(c => c.id === other.id)?.limit, 20000, "zero base receives the supplement")
  assert.equal(budget.categories.find(c => c.id === other.id)?.used, 60000)
  assert.equal(budget.categories.find(c => c.id === category.id)?.limit, 110000)
  await assert.rejects(transactionRepository.setCategory(expense.id, null), /REIMBURSEMENT_PROTECTED/)
  await assert.rejects(prisma.transaction.update({ where: { id: expense.id }, data: { amount: 10000 } }), /REIMBURSEMENT_PROTECTED/)
  await assert.rejects(prisma.transaction.update({ where: { id: expense.id }, data: { transactionDate: new Date("2026-12-01") } }), /REIMBURSEMENT_PROTECTED/)
  await assert.rejects(categoryRepository.delete(other.id), /reembolsos presupuestados/)
  await assert.rejects(prisma.category.update({ where: { id: other.id }, data: { type: "income" } }), /REIMBURSEMENT_PROTECTED/)
  await transactionRepository.setCategory(expense.id, category.id)

  // New link retries with different operationIds still encounter the unique pair.
  const credit2 = await movement("credit2", 10000, "credit", income.id)
  const pair = { expenseId: expense.id, creditId: credit2.id, amount: 10000 }
  const racing = await Promise.all([linkReimbursement(userId, pair), linkReimbursement(userId, pair)])
  assert.equal(racing.filter(r => r.created).length, 1)
  assert.equal(racing[0].reimbursementId, racing[1].reimbursementId)
  assert.equal((await view("card_cycle")).allocated, 140000)

  // One credit shared across expenses; concurrent capacity cannot be spent twice.
  const shared = await movement("shared", 10000, "credit", income.id)
  const secondExpense = await movement("second", 15000)
  const capacity = await Promise.allSettled([
    linkReimbursement(userId, { expenseId: expense.id, creditId: shared.id, amount: 7000 }),
    linkReimbursement(userId, { expenseId: secondExpense.id, creditId: shared.id, amount: 7000 }),
  ])
  assert.equal(capacity.filter(r => r.status === "fulfilled").length, 1)
  assert.equal(Number((await prisma.expenseReimbursement.aggregate({ where: { creditId: shared.id }, _sum: { amount: true } }))._sum.amount), 7000)
  const winner = capacity[0].status === "fulfilled" ? secondExpense : expense
  await linkReimbursement(userId, { expenseId: winner.id, creditId: shared.id, amount: 3000 })

  // No category/income category invalidates the whole operation. No orphan effect on rollback.
  const missing = await movement("missing", 2000, "debit", null)
  const freshCredit = await movement("fresh", 2000, "credit", income.id)
  await assert.rejects(linkReimbursement(userId, { expenseId: missing.id, creditId: freshCredit.id, amount: 2000 }), /categoría/)
  await prisma.transaction.update({ where: { id: missing.id }, data: { categoryId: income.id } })
  await assert.rejects(linkReimbursement(userId, { expenseId: missing.id, creditId: freshCredit.id, amount: 2000 }), /categoría/)
  const count = await prisma.reimbursementBudgetEffect.count()
  await assert.rejects(reimbursementTransaction(async db => {
    const r = await db.expenseReimbursement.create({ data: { userId, expenseId: missing.id, creditId: freshCredit.id, amount: 1000 } })
    await db.reimbursementBudgetEffect.create({ data: { reimbursementId: r.id, mode: "bad-mode", year: 2026, month: 11, categoryId: category.id, treatment: "automatic" } })
  }))
  assert.equal(await prisma.expenseReimbursement.count({ where: { expenseId: missing.id } }), 0)
  assert.equal(await prisma.reimbursementBudgetEffect.count(), count)

  // Explicit historical manual normalization is previewable and idempotent, never raises limits.
  const oldExpense = await movement("legacy-expense", 10000)
  const oldCredit = await movement("legacy-credit", 5000, "credit", income.id)
  const old = await prisma.expenseReimbursement.create({ data: { userId, expenseId: oldExpense.id, creditId: oldCredit.id, amount: 5000 } })
  const before = await view("card_cycle")
  const normalize = { userId, reimbursementIds: [old.id], mode: "card_cycle" as const }
  const preview = await normalizeManualReimbursements(normalize)
  assert.equal(preview.applied, false)
  assert.equal(await prisma.reimbursementBudgetEffect.count({ where: { reimbursementId: old.id } }), 0)
  await normalizeManualReimbursements({ ...normalize, apply: true })
  assert.equal((await view("card_cycle")).allocated, before.allocated)
  assert.equal((await view("card_cycle")).spent, before.spent + 5000)
  assert.equal((await normalizeManualReimbursements({ ...normalize, apply: true })).changes[0].alreadyNormalized, true)
  assert.equal((await linkReimbursement(userId, { expenseId: oldExpense.id, creditId: oldCredit.id, amount: 5000 })).created, false)
  await assert.rejects(normalizeManualReimbursements({ ...normalize, reimbursementIds: [first.reimbursementId], apply: true }), /automático/)
  await assert.rejects(transactionRepository.setCategory(oldExpense.id, other.id), /ajuste manual/)

  // Cascades reverse only the matching automatic supplement.
  const allocated = (await view("card_cycle")).allocated
  await prisma.expenseReimbursement.delete({ where: { id: first.reimbursementId } })
  assert.equal((await view("card_cycle")).allocated, allocated - 20000)
  await prisma.transaction.delete({ where: { id: credit2.id } })
  assert.equal((await view("card_cycle")).allocated, allocated - 30000)

  // Calendar uses the purchase month even when reimbursement arrives much later.
  await budgetPeriodRepository.setMode("calendar")
  const calendarExpense = await movement("calendar-expense", 8000, "debit", category.id, "2026-12-31")
  const laterCredit = await movement("later-credit", 4000, "credit", income.id, "2027-02-01")
  const calendarLink = await linkReimbursement(userId, { expenseId: calendarExpense.id, creditId: laterCredit.id, amount: 4000 })
  const calendarEffect = await prisma.reimbursementBudgetEffect.findUniqueOrThrow({ where: {
    reimbursementId_mode: { reimbursementId: calendarLink.reimbursementId, mode: "calendar" },
  } })
  assert.deepEqual([calendarEffect.year, calendarEffect.month], [2026, 12])
  assert.equal((await view("calendar", 2026, 12)).allocated, 104000)
  assert.equal((await view("calendar", 2027, 1)).allocated, 100000)
  await budgetPeriodRepository.setMode("card_cycle")
  await budgetPeriodRepository.setClosing(2026, 12, "2026-12-18")
  const cycleExpense = await movement("year-rollover", 1000, "debit", category.id, "2026-12-19")
  const cycleCredit = await movement("cycle-credit", 1000, "credit", income.id, "2027-01-02")
  const cycleLink = await linkReimbursement(userId, { expenseId: cycleExpense.id, creditId: cycleCredit.id, amount: 1000 })
  const cycleEffect = await prisma.reimbursementBudgetEffect.findUniqueOrThrow({ where: {
    reimbursementId_mode: { reimbursementId: cycleLink.reimbursementId, mode: "card_cycle" },
  } })
  assert.deepEqual([cycleEffect.year, cycleEffect.month], [2027, 1])
  await budgetPeriodRepository.setClosing(2026, 12, null)
  await prisma.transaction.delete({ where: { id: cycleExpense.id } })
  assert.equal(await prisma.reimbursementBudgetEffect.count({ where: { reimbursementId: cycleLink.reimbursementId } }), 0)
  console.log("Reimbursements: gross budget, periods/modes, caps, retries, concurrency, rollback, legacy normalization and cascades OK")
} finally {
  if (bankId) await prisma.bank.delete({ where: { id: bankId } })
  await prisma.category.deleteMany({ where: { userId } })
  await prisma.monthlyBudget.deleteMany({ where: { userId } })
  await prisma.$disconnect()
}
