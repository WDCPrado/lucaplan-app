// Integration regression: owns a disposable PostgreSQL container; never reads a real DATABASE_URL.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { setTimeout } from "node:timers/promises"
import { fileURLToPath } from "node:url"

const container = `lucaplan-plan-modes-test-${process.pid}`
const postgresImage = process.env.PLAN_MODES_POSTGRES_IMAGE ?? "postgres:17-alpine"
const docker = (args: string[], input?: string) => execFileSync("docker", args, {
  encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"],
}).trim()
const sql = (input: string) => docker(["exec", "-i", container, "psql", "-U", "test", "-d", "plan_modes_test", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], input)
let disconnect: (() => Promise<void>) | undefined
let containerId: string | undefined
try {
  containerId = docker(["run", "--name", container, "-e", "POSTGRES_USER=test", "-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=plan_modes_test", "-p", "127.0.0.1::5432", "-d", postgresImage])
  for (let attempt = 0; ; attempt++) {
    try { sql("SELECT 1"); break } catch (error) {
      if (attempt === 30) throw error
      await setTimeout(500)
    }
  }
  const port = docker(["port", container, "5432/tcp"]).split(":").at(-1)
  process.env.DATABASE_URL = `postgresql://test:test@127.0.0.1:${port}/plan_modes_test?schema=public`
  const migrations = readdirSync(new URL("../prisma/migrations/", import.meta.url)).filter(name => name !== "migration_lock.toml").sort()
  const target = "20261031090000_plan_per_mode"
  for (const name of migrations.filter(name => name < target))
    sql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8"))
  sql(`
    INSERT INTO bank (id,"userId",name,"updatedAt") VALUES ('bank','user','Demo',now());
    INSERT INTO financial_account (id,"userId","bankId",name,"accountType",currency,balance,"updatedAt") VALUES ('account','user','bank','Demo','checking','CLP',500,now());
    INSERT INTO category (id,"userId",name,type,"updatedAt") VALUES ('expense','user','Gasto','expense',now()),('salary','user','Sueldo','income',now());
    INSERT INTO income (id,"userId","accountId","categoryId",name,currency,"dayOfMonth","isActive","endedYear","endedMonth","updatedAt") VALUES
      ('income','user','account','salary','Sueldo','CLP',30,true,null,null,now()),
      ('ended','user','account','salary','Terminado','CLP',5,false,2026,10,now());
    INSERT INTO income_amount (id,"incomeId",year,month,amount,"updatedAt") VALUES ('ia1','income',2026,9,1000,now()),('ia2','income',2026,10,1200,now()),('ia3','ended',2026,8,200,now());
    INSERT INTO monthly_budget (id,"userId",year,month,"globalLimit","updatedAt") VALUES ('mb1','user',2026,9,900,now()),('mb2','user',2026,10,1100,now());
    INSERT INTO category_limit (id,"categoryId",year,month,"limitAmount","updatedAt") VALUES ('cl1','expense',2026,9,400,now()),('cl2','expense',2026,10,500,now());
    INSERT INTO transaction (id,"userId","accountId","categoryId","incomeId","transactionDate",description,amount,currency,direction,"updatedAt") VALUES ('legacy','user','account','salary','income','2026-09-30','Cobro real',1000,'CLP','credit',now());
  `)
  const before = sql(`SELECT row_to_json(t) FROM transaction t; SELECT row_to_json(a) FROM financial_account a;`)
  const migration = readFileSync(new URL(`../prisma/migrations/${target}/migration.sql`, import.meta.url), "utf8")
  sql(`UPDATE income SET "endedMonth"=13 WHERE id='ended'`)
  assert.throws(() => sql(migration), "datos inválidos abortan todo el backfill")
  assert.equal(sql(`SELECT count(*) FROM information_schema.columns WHERE table_name='income_amount' AND column_name='mode'`), "0")
  sql(`UPDATE income SET "endedMonth"=10 WHERE id='ended'`)
  sql(migration)
  assert.equal(sql(`SELECT row_to_json(t) FROM transaction t; SELECT row_to_json(a) FROM financial_account a;`), before)
  for (const table of ["category_limit", "monthly_budget", "income_amount"])
    assert.equal(sql(`SELECT count(*) FROM (SELECT to_jsonb(t)-'id'-'mode' value FROM ${table} t WHERE mode='calendar' EXCEPT SELECT to_jsonb(t)-'id'-'mode' FROM ${table} t WHERE mode='card_cycle') q`), "0")
  assert.equal(sql(`SELECT count(*) FROM income_plan WHERE "incomeId"='ended' AND NOT "isActive" AND "endedYear"=2026 AND "endedMonth"=10`), "2")
  assert.throws(() => sql(`UPDATE income_plan SET "endedMonth"=13 WHERE "incomeId"='ended'`))
  assert.throws(() => sql(`UPDATE income_plan SET "endedMonth"=NULL WHERE "incomeId"='ended'`))
  assert.throws(() => sql(`UPDATE monthly_budget SET mode='other'`))
  // Las migraciones posteriores, para que la base calce con el schema actual.
  for (const name of migrations.filter(name => name > target))
    sql(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8"))
  execFileSync(process.execPath, [fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url)), "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], { stdio: "pipe" })

  const { prisma } = await import("../arch/v1/infrastructure/database/prisma/client.ts")
  disconnect = () => prisma.$disconnect()
  const { incomeRepository } = await import("../arch/v1/infrastructure/database/prisma/income.infrastructure.ts")
  const { accountRepository, bankRepository, categoryRepository, monthlyBudgetRepository, transactionRepository } = await import("../arch/v1/infrastructure/database/prisma/finance.infrastructure.ts")
  const { getBudgetView, getPreviousMonthDebt, listIncomesView } = await import("../arch/v1/application/finance-use-cases/finance-read.ts")
  const { createIncome, updateIncome, deleteIncome, generateMonthlyIncome } = await import("../arch/v1/application/finance-use-cases/income-use-cases.ts")
  const { setMonthlyBudget } = await import("../arch/v1/application/finance-use-cases/set-monthly-budget-use-case.ts")
  const { setCategoryLimit } = await import("../arch/v1/application/finance-use-cases/upsert-category-use-case.ts")
  const { scopeBudgetPeriod } = await import("../arch/v1/application/finance-use-cases/budget-period-use-cases.ts")
  const { alignGlobalLimit } = await import("../arch/v1/application/finance-use-cases/follow-income.ts")
  const base = { budgetPeriod: undefined, accounts: accountRepository, banks: bankRepository, categories: categoryRepository, monthlyBudgets: monthlyBudgetRepository, transactions: transactionRepository, incomes: incomeRepository, exchangeRates: { clpPerUsdAt: async () => 950 } }
  const debit = await scopeBudgetPeriod(base, "calendar")
  const credit = await scopeBudgetPeriod(base, "card_cycle")
  for (const deps of [debit, credit]) {
    const view = await getBudgetView(deps, "user", 2026, 11)
    assert.equal(view.globalLimit, 1100)
    assert.equal(view.income, 1200)
    assert.equal(view.allocated, 500)
  }
  await setMonthlyBudget(credit, "user", { year: 2026, month: 11, globalLimit: 1800 })
  await setCategoryLimit(credit, "user", { categoryId: "expense", year: 2026, month: 11, limit: 700 })
  const input = { id: "income", accountId: "account", categoryId: "salary", name: "Sueldo", amount: 2000, dayOfMonth: 30, year: 2026, month: 11, isActive: true }
  await updateIncome(credit, "user", input)
  const d = await getBudgetView(debit, "user", 2026, 12)
  const c = await getBudgetView(credit, "user", 2026, 12)
  assert.deepEqual([d.globalLimit, d.allocated, d.income], [1100, 500, 1200])
  assert.deepEqual([c.globalLimit, c.allocated, c.income], [1800, 700, 2000])
  assert.equal((await getBudgetView(credit, "user", 2026, 10)).globalLimit, 1100)
  await updateIncome(credit, "user", { ...input, isActive: false })
  assert.equal((await getBudgetView(credit, "user", 2026, 12)).income, 0)
  assert.equal((await getBudgetView(debit, "user", 2026, 12)).income, 1200)
  await updateIncome(credit, "user", input)

  // Overlapping calendar/cycle calls share one real credit, including concurrent requests.
  const generated = await Promise.all([
    generateMonthlyIncome(debit, "user", { incomeId: "income", year: 2026, month: 10 }),
    generateMonthlyIncome(credit, "user", { incomeId: "income", year: 2026, month: 11 }),
  ])
  assert.equal(generated.filter(result => result.created).length, 1)
  assert.equal(generated[0].transactionId, generated[1].transactionId)
  assert.equal(await prisma.transaction.count({ where: { incomeId: "income" } }), 2)
  assert.equal((await listIncomesView(credit, "user", 2026, 11))[0].generated, true)
  assert.equal((await listIncomesView(debit, "user", 2026, 10))[0].generated, true)
  const actual = await prisma.transaction.findUniqueOrThrow({ where: { id: generated[0].transactionId } })
  const account = await prisma.financialAccount.findUniqueOrThrow({ where: { id: "account" } })
  assert.equal(Number(account.balance), 500 + Number(actual.amount))
  await deleteIncome(credit, "user", "income", { year: 2026, month: 12 })
  await assert.rejects(generateMonthlyIncome(credit, "user", { incomeId: "income", year: 2026, month: 12 }), /no está vigente/)
  assert.equal((await listIncomesView(credit, "user", 2026, 12)).length, 0)
  assert.equal((await listIncomesView(debit, "user", 2026, 12)).length, 1)
  assert.equal((await listIncomesView(credit, "user", 2026, 11)).length, 1)
  assert.equal(await prisma.transaction.count({ where: { incomeId: "income" } }), 2)
  const added = await createIncome(credit, "user", { ...input, name: "Solo crédito", amount: 300, year: 2026, month: 12 })
  assert.equal(await incomeRepository.findById(added.id, "calendar"), null)
  assert.ok((await incomeRepository.listAvailableSources("user", "calendar")).some(source => source.id === added.id))
  await assert.rejects(createIncome(debit, "another-user", { ...input, sourceId: added.id }), /no está disponible/)
  const incorporated = await createIncome(debit, "user", { ...input, sourceId: added.id, name: "No cambia identidad", amount: 500, month: 12 })
  assert.equal(incorporated.id, added.id)
  assert.equal(incorporated.name, "Solo crédito")
  await assert.rejects(createIncome(debit, "user", { ...input, sourceId: added.id }), /no está disponible/)
  assert.equal((await incomeRepository.listAvailableSources("user", "calendar")).length, 0)
  assert.equal((await incomeRepository.listAvailableSources("user", "card_cycle")).some(source => source.id === "income"), false, "terminar no ofrece reactivación que reescriba historia")
  const newCredit = await Promise.all([
    generateMonthlyIncome(debit, "user", { incomeId: added.id, year: 2026, month: 12 }),
    generateMonthlyIncome(credit, "user", { incomeId: added.id, year: 2027, month: 1 }),
  ])
  assert.equal(newCredit.filter(result => result.created).length, 1)
  assert.equal(newCredit[0].transactionId, newCredit[1].transactionId)
  // El tope de tarjeta se fijó a mano (1800, sin la marca): ni el ingreso nuevo ni el cobro lo resiembran.
  assert.equal((await alignGlobalLimit(credit, "user", { today: "2026-12-15" }))?.seeded, false)
  assert.equal((await getBudgetView(credit, "user", 2026, 12)).globalLimit, 1800)

  await prisma.transaction.create({ data: { userId: "user", accountId: "account", categoryId: "expense", transactionDate: new Date("2026-10-23"), description: "Después del cierre", amount: 1500, currency: "CLP", direction: "debit" } })
  assert.equal(await getPreviousMonthDebt(credit, "user", 2026, 11), 0)
  assert.equal(await getPreviousMonthDebt(debit, "user", 2026, 11), 300)
  assert.equal(await prisma.financialAccount.count(), 1)
  assert.equal(await prisma.category.count(), 2)
  console.log(`${postgresImage}: migration preserves history and real data; independent modes/carry/validity/deficit; one concurrent shared credit: OK`)
} finally {
  await disconnect?.()
  if (containerId) docker(["rm", "-f", containerId])
}
