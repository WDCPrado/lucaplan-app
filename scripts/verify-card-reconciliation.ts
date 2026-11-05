// PostgreSQL real; solo una base local desechable, nunca DATABASE_URL del usuario.
import assert from "node:assert/strict"
import type { BankReconciliationInput } from "../lib/schemas/bank-reconciliation.ts"
import type { BankReconciliationPlan } from "../arch/v1/domain/finance/bank-reconciliation.domain.ts"

const url = new URL(
  process.env.INSTALLMENT_TEST_DATABASE_URL ?? "http://missing"
)
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/card_correction_test"
)
  throw new Error(
    "INSTALLMENT_TEST_DATABASE_URL debe apuntar a la base local aislada card_correction_test"
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
const { committedForMonth } =
  await import("../arch/v1/domain/finance/installment.domain.ts")
const { Money } = await import("../arch/v1/domain/finance/money.ts")

const userId = `card-test-${crypto.randomUUID()}`
const now = new Date("2026-11-04T23:00:00Z")
const deps = {
  bankReconciliation: bankReconciliationStore,
  installments: installmentPlanRepository,
}
try {
  if (process.env.VERIFY_CARD_DEMO_SEED === "1") {
    const demo = await prisma.user.findUnique({
      where: { email: process.env.SEED_PR_EMAIL ?? "demo@lucaplan.cl" },
    })
    assert.ok(demo, "el seed debe crear la cuenta demo antes de verificarla")
    const seededPlans = await prisma.installmentPlan.findMany({
      where: {
        userId: demo.id,
        description: {
          in: [
            "Compra demo con intereses",
            "Compra demo parcialmente facturada",
          ],
        },
      },
      include: {
        account: true,
        sourceTransaction: true,
        items: {
          orderBy: { index: "asc" },
          include: { transaction: true },
        },
      },
    })
    assert.equal(
      seededPlans.length,
      2,
      "los dos casos demo deben existir una sola vez"
    )
    for (const [description, settledFirst] of [
      ["Compra demo con intereses", false],
      ["Compra demo parcialmente facturada", true],
    ] as const) {
      const plan = seededPlans.find((p) => p.description === description)
      assert.ok(plan, `falta el caso demo: ${description}`)
      assert.equal(plan.kind, "card")
      assert.equal(plan.account.userId, demo.id)
      assert.equal(plan.account.accountType, "credit_card")
      assert.equal(plan.currency, "CLP")
      assert.equal(Number(plan.totalAmount), 600000)
      assert.equal(plan.installmentsCount, 6)
      assert.equal(plan.items.length, 6)
      const source = plan.sourceTransaction
      assert.ok(source, "la compra original debe estar vinculada")
      assert.equal(source.id, plan.sourceTransactionId)
      assert.equal(source.userId, demo.id)
      assert.equal(source.accountId, plan.accountId)
      assert.equal(source.categoryId, plan.categoryId)
      assert.equal(source.currency, "CLP")
      assert.equal(Number(source.amount), 600000)
      assert.equal(source.direction, "debit")
      assert.equal(source.status, "confirmed")
      assert.equal(
        source.isInternal,
        true,
        "la compra original no duplica el presupuesto"
      )
      for (const [index, item] of plan.items.entries()) {
        assert.equal(item.index, index + 1)
        assert.equal(Number(item.amount), 100000)
        assert.equal(item.paidOutsideApp, false)
        if (settledFirst && index === 0) {
          const transaction = item.transaction
          assert.ok(
            transaction,
            "la primera cuota debe conservar su facturación demo"
          )
          assert.equal(transaction.installmentItemId, item.id)
          assert.equal(transaction.userId, demo.id)
          assert.equal(transaction.accountId, plan.accountId)
          assert.equal(transaction.categoryId, plan.categoryId)
          assert.equal(transaction.currency, "CLP")
          assert.equal(Number(transaction.amount), 100000)
          assert.equal(transaction.status, "confirmed")
          assert.equal(transaction.direction, "debit")
          assert.equal(transaction.isInternal, false)
          assert.deepEqual(transaction.transactionDate, item.dueDate)
        } else {
          assert.equal(
            item.transaction,
            null,
            "el seed no factura cuotas pendientes"
          )
        }
      }
    }
    console.log(
      "Card demo seed: both scenarios, amounts, neutralized sources and billed history OK"
    )
  }
  const bank = await prisma.bank.create({ data: { userId, name: "Card QA" } })
  const account = await prisma.financialAccount.create({
    data: {
      userId,
      bankId: bank.id,
      name: "Tarjeta demo",
      accountType: "credit_card",
      currency: "CLP",
      balance: -1200000,
    },
  })
  const bucket = await prisma.balanceBucket.create({
    data: {
      userId,
      accountId: account.id,
      kind: "credit_national",
      currency: "CLP",
      limitAmount: 2000000,
      used: 1200000,
      available: 800000,
    },
  })
  const category = await prisma.category.create({
    data: { userId, name: "Compras QA", type: "expense" },
  })
  const createCard = async (description: string, dates: string[]) => {
    const source = await prisma.transaction.create({
      data: {
        userId,
        accountId: account.id,
        categoryId: category.id,
        bucketId: bucket.id,
        description,
        amount: 600000,
        currency: "CLP",
        direction: "debit",
        status: "confirmed",
        isInternal: true,
        externalId: `source-${crypto.randomUUID()}`,
        transactionDate: new Date("2026-07-10"),
      },
    })
    const plan = await prisma.installmentPlan.create({
      data: {
        userId,
        accountId: account.id,
        categoryId: category.id,
        kind: "card",
        sourceTransactionId: source.id,
        description,
        totalAmount: 600000,
        currency: "CLP",
        installmentsCount: 6,
        startDate: new Date(dates[0]),
        dayOfMonth: 20,
        items: {
          create: dates.map((date, index) => ({
            index: index + 1,
            amount: 100000,
            dueDate: new Date(date),
          })),
        },
      },
      include: { items: { orderBy: { index: "asc" } } },
    })
    return { source, plan }
  }
  const pending = await createCard("Compra financiada QA", [
    "2026-11-20",
    "2026-12-23",
    "2027-01-21",
    "2027-02-18",
    "2027-03-23",
    "2027-04-22",
  ])
  const partial = await createCard("Compra con historial QA", [
    "2026-08-20",
    "2026-09-22",
    "2026-10-22",
    "2026-11-20",
    "2026-12-23",
    "2027-01-21",
  ])
  const billed = await prisma.transaction.create({
    data: {
      userId,
      accountId: account.id,
      categoryId: category.id,
      installmentItemId: partial.plan.items[0].id,
      description: "Compra con historial QA · cuota 1/6",
      amount: 100000,
      currency: "CLP",
      direction: "debit",
      status: "confirmed",
      transactionDate: partial.plan.items[0].dueDate,
    },
  })
  await prisma.installmentItem.update({
    where: { id: partial.plan.items[1].id, plan: { userId } },
    data: { paidOutsideApp: true },
  })
  const input: BankReconciliationInput = {
    accountId: account.id,
    snapshotAt: "2026-11-04T18:00:00Z",
    source: "Estado de cuenta QA",
    buckets: [
      {
        kind: "credit_national",
        currency: "CLP",
        limit: 2000000,
        used: 1200000,
        available: 800000,
      },
    ],
    corrections: [],
    additions: [],
    includedSameDayIds: [],
    cardCorrections: [
      {
        planId: pending.plan.id,
        totalAmount: 678000,
        evidence: "Cronograma QA: seis cuotas de 113000, total 678000",
        items: pending.plan.items.map((i) => ({
          itemId: i.id,
          amount: 113000,
        })),
      },
      {
        planId: partial.plan.id,
        totalAmount: 678000,
        evidence: "Cronograma QA: dos cuotas de 100000 y cuatro de 119500",
        items: partial.plan.items.map((i) => ({
          itemId: i.id,
          amount: i.index <= 2 ? 100000 : 119500,
        })),
      },
    ],
  }
  const read = async () => ({
    plans: await prisma.installmentPlan.findMany({
      where: { userId, accountId: account.id },
      include: { items: { orderBy: { index: "asc" } } },
      orderBy: { id: "asc" },
    }),
    movements: await prisma.transaction.findMany({
      where: { userId, accountId: account.id },
      orderBy: { id: "asc" },
    }),
    account: await prisma.financialAccount.findFirstOrThrow({
      where: { id: account.id, userId },
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
  assert.equal(first.cardCorrections[0].outstandingBefore, 600000)
  assert.equal(first.cardCorrections[0].outstandingAfter, 678000)
  assert.equal(first.cardCorrections[1].outstandingBefore, 400000)
  assert.equal(first.cardCorrections[1].outstandingAfter, 478000)
  assert.deepEqual(first.corrections, [], "no corrige compras ni facturaciones")
  assert.deepEqual(first.additions, [], "no registra cuotas pendientes")

  // Un fallo de persistencia a mitad del segundo plan deshace también el primero.
  await assert.rejects(
    bankReconciliationStore.withUserLock(userId, async (tx) => {
      const loaded = await tx.loadState(userId, account.id)
      assert.ok(loaded)
      const plan = {
        ...planBankReconciliation(loaded.state, input, now),
        beforeBuckets: loaded.beforeBuckets,
      }
      plan.cardCorrections[1].after.items[5].id =
        "missing-card-item-for-rollback"
      await tx.apply(userId, input, plan, "card-write-failure-test", now)
    }),
    /record/i
  )
  assert.deepEqual(
    await read(),
    before,
    "un error de escritura revierte el lote"
  )

  // Fuerza un fallo tras escribir ambos planes, sus cuotas, los saldos y el recibo.
  await assert.rejects(
    bankReconciliationStore.withUserLock(userId, async (tx) => {
      const loaded = await tx.loadState(userId, account.id)
      assert.ok(loaded)
      const plan = {
        ...planBankReconciliation(loaded.state, input, now),
        beforeBuckets: loaded.beforeBuckets,
      }
      await tx.apply(userId, input, plan, "card-rollback-test", now)
      throw new Error("fallo simulado después del recibo")
    }),
    /fallo simulado/
  )
  assert.deepEqual(await read(), before, "rollback conserva todas las filas")

  await prisma.installmentItem.update({
    where: { id: pending.plan.items[5].id, plan: { userId } },
    data: { dueDate: new Date("2027-04-23") },
  })
  await assert.rejects(
    reconcileBankAccount(deps, userId, input, first.previewToken, now),
    /repite/,
    "cambiar una cuota invalida la previsualización"
  )
  const second = await preview()
  await prisma.transaction.update({
    where: { id: pending.source.id, userId },
    data: { description: "Compra financiada QA revisada" },
  })
  await assert.rejects(
    reconcileBankAccount(deps, userId, input, second.previewToken, now),
    /repite/,
    "cambiar la compra fuente invalida la previsualización"
  )
  const { previewToken } = await preview()
  await assert.rejects(
    reconcileBankAccount(deps, "otro-usuario", input, previewToken, now),
    /no pertenece/
  )
  await assert.rejects(
    reconcileBankAccount(
      deps,
      userId,
      {
        ...input,
        cardCorrections: [{ ...input.cardCorrections![0], planId: "ajeno" }],
      },
      undefined,
      now
    ),
    /ajeno/
  )
  const unchanged = await read()
  const stalePlan = await installmentPlanRepository.findById(pending.plan.id)
  assert.ok(stalePlan)
  const staleUpdates = stalePlan.items.map((item, index) => ({
    itemId: item.id,
    amount: Money.of(index === 0 ? 110000 : 98000, "CLP"),
    dueDate: item.dueDate,
  }))
  const applied = await reconcileBankAccount(
    deps,
    userId,
    input,
    previewToken,
    now
  )
  const after = await read()
  assert.deepEqual(
    await reconcileBankAccount(deps, userId, input, previewToken, now),
    applied,
    "repetir el token devuelve el mismo recibo"
  )
  assert.deepEqual(await read(), after, "el reintento no vuelve a escribir")
  await assert.rejects(
    installmentPlanRepository.updateItems(staleUpdates, stalePlan),
    /El plan cambió/,
    "una edición calculada con el total anterior no puede deshacer la conciliación"
  )
  assert.deepEqual(
    await read(),
    after,
    "la edición obsoleta no deja escrituras parciales"
  )
  assert.equal(after.receipts, 1)
  assert.deepEqual(
    after.movements,
    unchanged.movements,
    "conserva completos compras fuente y movimiento facturado; no crea duplicados"
  )
  assert.equal(after.movements.length, 3)
  assert.equal(
    Number(after.movements.find((m) => m.id === pending.source.id)!.amount),
    600000,
    "la compra conserva el capital original"
  )
  assert.equal(
    after.movements.find((m) => m.id === billed.id)!.amount.toNumber(),
    100000
  )
  for (const plan of after.plans) {
    const old = unchanged.plans.find((p) => p.id === plan.id)!
    assert.equal(Number(plan.totalAmount), 678000)
    assert.deepEqual(
      {
        ...plan,
        totalAmount: undefined,
        updatedAt: undefined,
        items: undefined,
      },
      {
        ...old,
        totalAmount: undefined,
        updatedAt: undefined,
        items: undefined,
      },
      "conserva la identidad y metadatos del plan"
    )
    assert.deepEqual(
      plan.items.map((i) => [i.id, i.index, i.dueDate, i.paidOutsideApp]),
      old.items.map((i) => [i.id, i.index, i.dueDate, i.paidOutsideApp])
    )
    if (plan.id === pending.plan.id) {
      assert.deepEqual(
        plan.items.map((i) => Number(i.amount)),
        Array(6).fill(113000)
      )
    } else {
      assert.deepEqual(
        plan.items.slice(0, 2),
        old.items.slice(0, 2),
        "no escribe las cuotas saldadas"
      )
      assert.deepEqual(
        plan.items.map((i) => Number(i.amount)),
        [100000, 100000, 119500, 119500, 119500, 119500]
      )
    }
  }
  assert.equal(Number(after.bucket.limitAmount), 2000000)
  assert.equal(Number(after.bucket.used), 1200000)
  assert.equal(Number(after.bucket.available), 800000)
  assert.equal(Number(after.account.balance), -1200000)
  const domain = await installmentPlanRepository.findById(pending.plan.id)
  assert.ok(domain)
  assert.equal(
    committedForMonth(domain, {
      start: "2026-11-01",
      end: "2026-11-30",
    }).toMajor(),
    113000,
    "el comprometido se deriva de la cuota corregida"
  )
  const receipt = await prisma.bankReconciliation.findFirstOrThrow({
    where: { userId, token: previewToken },
  })
  const audit = receipt.result as {
    cardCorrections: BankReconciliationPlan["cardCorrections"]
  }
  assert.equal(audit.cardCorrections[0].before.totalAmount, 600000)
  assert.equal(audit.cardCorrections[0].after.totalAmount, 678000)
  assert.equal(
    audit.cardCorrections[0].evidence,
    input.cardCorrections![0].evidence
  )

  // El total no basta como versión: otro cronograma del mismo total también invalida la edición.
  const staleSameTotal = await installmentPlanRepository.findById(
    pending.plan.id
  )
  assert.ok(staleSameTotal)
  const sameTotalUpdates = staleSameTotal.items.map((item, index) => ({
    itemId: item.id,
    amount: Money.of(
      index === 0 ? 114000 : index === 1 ? 112000 : 113000,
      "CLP"
    ),
    dueDate: item.dueDate,
  }))
  const redistributedInput: BankReconciliationInput = {
    ...input,
    cardCorrections: [
      {
        ...input.cardCorrections![0],
        evidence:
          "Cronograma QA revisado: 112000, 114000 y cuatro cuotas de 113000",
        items: pending.plan.items.map((item, index) => ({
          itemId: item.id,
          amount: index === 0 ? 112000 : index === 1 ? 114000 : 113000,
        })),
      },
    ],
  }
  const redistributionPreview = (await reconcileBankAccount(
    deps,
    userId,
    redistributedInput,
    undefined,
    now
  )) as BankReconciliationPlan & { previewToken: string }
  await reconcileBankAccount(
    deps,
    userId,
    redistributedInput,
    redistributionPreview.previewToken,
    now
  )
  const redistributed = await read()
  const redistributedPlan = redistributed.plans.find(
    (p) => p.id === pending.plan.id
  )!
  assert.equal(Number(redistributedPlan.totalAmount), 678000)
  assert.deepEqual(
    redistributedPlan.items.map((i) => Number(i.amount)),
    [112000, 114000, 113000, 113000, 113000, 113000]
  )
  await assert.rejects(
    installmentPlanRepository.updateItems(sameTotalUpdates, staleSameTotal),
    /El plan cambió/,
    "el cambio de cuotas se detecta aunque el total siga siendo el mismo"
  )
  assert.deepEqual(
    await read(),
    redistributed,
    "conserva el cronograma nuevo y su recibo"
  )
  console.log(
    "Card reconciliation: preview, ownership, stale token and installment edits, rollback, pending amounts, billed history, original purchase, balances, committed budget, audit and retry OK"
  )
} finally {
  await prisma.bankReconciliation.deleteMany({ where: { userId } })
  await prisma.bank.deleteMany({ where: { userId } })
  await prisma.category.deleteMany({ where: { userId } })
  await prisma.$disconnect()
}
