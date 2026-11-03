// PostgreSQL real en CI; solo una base local desechable, nunca DATABASE_URL del usuario.
import assert from "node:assert/strict"
import type { BankReconciliationInput } from "../lib/schemas/bank-reconciliation.ts"
import type { BankReconciliationPlan } from "../arch/v1/domain/finance/bank-reconciliation.domain.ts"

const url = new URL(
  process.env.INSTALLMENT_TEST_DATABASE_URL ?? "http://missing"
)
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/loan_correction_test"
)
  throw new Error(
    "INSTALLMENT_TEST_DATABASE_URL debe apuntar a la base local aislada loan_correction_test"
  )
process.env.DATABASE_URL = url.toString()
const { prisma } =
  await import("../arch/v1/infrastructure/database/prisma/client.ts")
const { bankReconciliationStore } =
  await import("../arch/v1/infrastructure/database/prisma/bank-reconciliation.infrastructure.ts")
const { reconcileBankAccount, planBankReconciliation } =
  await import("../arch/v1/application/finance-use-cases/bank-reconciliation.ts")
const { installmentPlanRepository } =
  await import("../arch/v1/infrastructure/database/prisma/installment.infrastructure.ts")
const { outstanding } =
  await import("../arch/v1/domain/finance/installment.domain.ts")
const { Money } = await import("../arch/v1/domain/finance/money.ts")
const { decideEmailNotice } =
  await import("../arch/v1/domain/finance/bank-reconciliation.domain.ts")

const userId = `loan-test-${crypto.randomUUID()}`
const now = new Date("2026-11-03T18:00:00Z")
// Este caso no salda planes card; su listado independiente ya tiene pruebas propias.
const deps = {
  bankReconciliation: bankReconciliationStore,
  installments: { listActiveByAccount: async () => [] },
}
try {
  const bank = await prisma.bank.create({ data: { userId, name: "Loan QA" } })
  const account = await prisma.financialAccount.create({
    data: {
      userId,
      bankId: bank.id,
      name: "Tarjeta demo",
      accountType: "credit_card",
      currency: "CLP",
      balance: -400000,
    },
  })
  const bucket = await prisma.balanceBucket.create({
    data: {
      userId,
      accountId: account.id,
      kind: "credit_national",
      currency: "CLP",
      limitAmount: 1000000,
      used: 400000,
      available: 600000,
    },
  })
  const category = await prisma.category.create({
    data: { userId, name: "Avance demo", type: "expense" },
  })
  const loan = await prisma.installmentPlan.create({
    data: {
      userId,
      accountId: account.id,
      categoryId: category.id,
      kind: "loan",
      description: "Avance QA",
      totalAmount: 335000,
      currency: "CLP",
      installmentsCount: 3,
      startDate: new Date("2026-09-22"),
      dayOfMonth: 22,
      items: {
        create: [1, 2, 3].map((index) => ({
          index,
          amount: 111627,
          dueDate: new Date(`2026-${String(index + 8).padStart(2, "0")}-22`),
        })),
      },
    },
    include: { items: { orderBy: { index: "asc" } } },
  })
  const payments = []
  for (const [i, amount] of [111666, 111627].entries()) {
    payments.push(
      await prisma.transaction.create({
        data: {
          userId,
          accountId: account.id,
          categoryId: category.id,
          installmentItemId: loan.items[i].id,
          description: "Avance QA",
          amount,
          currency: "CLP",
          direction: "debit",
          status: "confirmed",
          externalId: i === 0 ? "demo-loan-email" : null,
          transactionDate: new Date(`2026-0${i + 8}-22`),
        },
      })
    )
  }
  const input: BankReconciliationInput = {
    accountId: account.id,
    snapshotAt: "2026-11-02T21:00:00Z",
    source: "Cartola QA",
    buckets: [
      {
        kind: "credit_national",
        currency: "CLP",
        limit: 1000000,
        used: 400000,
        available: 600000,
      },
    ],
    corrections: [],
    additions: [],
    includedSameDayIds: [],
    loanCorrections: [
      {
        planId: loan.id,
        totalAmount: 334881,
        evidence: "Avance QA, 3 cuotas de 111627",
        items: loan.items.map((i) => ({ itemId: i.id, amount: 111627 })),
      },
    ],
  }
  const read = async () => ({
    plan: await prisma.installmentPlan.findFirstOrThrow({
      where: { id: loan.id, userId },
      include: { items: { orderBy: { index: "asc" } } },
    }),
    payments: await prisma.transaction.findMany({
      where: { userId, accountId: account.id },
      orderBy: { transactionDate: "asc" },
    }),
    bucket: await prisma.balanceBucket.findFirstOrThrow({
      where: { id: bucket.id, userId },
    }),
    receipts: await prisma.bankReconciliation.count({ where: { userId } }),
  })
  const before = await read()
  const preview = async () =>
    (await reconcileBankAccount(
      deps,
      userId,
      input,
      undefined,
      now
    )) as BankReconciliationPlan & { previewToken: string }
  const first = await preview()
  assert.deepEqual(await read(), before, "previsualizar no escribe")
  assert.equal(first.loanCorrections[0].outstandingBefore, 111707)
  assert.equal(first.loanCorrections[0].outstandingAfter, 111627)

  // Falla DESPUÉS de escribir plan, ítems, pagos, buckets y recibo: todo debe volver atrás.
  await assert.rejects(
    bankReconciliationStore.withUserLock(userId, async (tx) => {
      const state = await tx.loadState(userId, account.id)
      assert.ok(state)
      const plan = {
        ...planBankReconciliation(state.state, input, now),
        beforeBuckets: state.beforeBuckets,
      }
      await tx.apply(userId, input, plan, "rollback-test", now)
      throw new Error("fallo simulado después del recibo")
    }),
    /fallo simulado/
  )
  assert.deepEqual(await read(), before, "rollback conserva todas las filas")

  await prisma.installmentPlan.update({
    where: { id: loan.id, userId },
    data: { description: "Avance QA revisado" },
  })
  await assert.rejects(
    reconcileBankAccount(deps, userId, input, first.previewToken, now),
    /repite/
  )
  const { previewToken } = await preview()
  await assert.rejects(
    reconcileBankAccount(deps, "otro-usuario", input, previewToken, now),
    /no pertenece/
  )
  const otherPlan = {
    ...input,
    loanCorrections: [{ ...input.loanCorrections![0], planId: "ajeno" }],
  }
  await assert.rejects(
    reconcileBankAccount(deps, userId, otherPlan, undefined, now),
    /ajeno/
  )

  const applied = await reconcileBankAccount(
    deps,
    userId,
    input,
    previewToken,
    now
  )
  assert.deepEqual(
    await reconcileBankAccount(deps, userId, input, previewToken, now),
    applied
  )
  const after = await read()
  assert.equal(Number(after.plan.totalAmount), 334881)
  assert.equal(after.receipts, 1)
  assert.deepEqual(
    after.plan.items.map((i) => [i.id, i.dueDate, i.paidOutsideApp]),
    before.plan.items.map((i) => [i.id, i.dueDate, i.paidOutsideApp])
  )
  assert.deepEqual(
    after.payments.map((p) => [
      p.id,
      p.installmentItemId,
      p.externalId,
      p.transactionDate,
    ]),
    payments.map((p) => [
      p.id,
      p.installmentItemId,
      p.externalId,
      p.transactionDate,
    ])
  )
  assert.deepEqual(
    after.payments.map((p) => Number(p.amount)),
    [111627, 111627]
  )
  assert.equal(after.payments[0].bucketId, bucket.id)
  assert.equal(
    after.payments[1].reconciliation,
    null,
    "no toca conciliación de pagos sin cambio"
  )
  assert.equal(Number(after.bucket.used), 400000)
  assert.equal(Number(after.bucket.available), 600000)
  assert.equal(after.plan.items.length, 3)
  const domain = await installmentPlanRepository.findById(loan.id)
  assert.ok(domain)
  assert.equal(
    outstanding(
      domain,
      after.payments.map((p) => Money.of(Number(p.amount), "CLP"))
    ).toMajor(),
    111627
  )
  const corrected = after.payments[0]
  const audit = corrected.reconciliation as {
    correctedLoanPlanId: string
    original: { amount: number }
    evidence: string
  }
  assert.equal(audit.correctedLoanPlanId, loan.id)
  assert.equal(audit.original.amount, 111666)
  assert.equal(audit.evidence, input.loanCorrections![0].evidence)
  assert.deepEqual(
    decideEmailNotice(
      {
        date: "2026-08-22",
        description: "Avance QA",
        amount: 111666,
        currency: "CLP",
        direction: "debit",
      },
      { reconciled: !!corrected.reconciliation },
      []
    ),
    { kind: "keep" },
    "el correo no pisa la corrección"
  )
  console.log(
    "Loan reconciliation: preview, ownership, stale token, rollback, identity, balances, audit and retry OK"
  )
} finally {
  await prisma.bankReconciliation.deleteMany({ where: { userId } })
  await prisma.bank.deleteMany({ where: { userId } })
  await prisma.category.deleteMany({ where: { userId } })
  await prisma.$disconnect()
}
