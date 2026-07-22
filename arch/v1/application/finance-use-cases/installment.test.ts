// Casos de uso de cuotas: alta (con neutralización de la compra origen y cuotas ya pagadas), los
// dos disparadores —card CREA el movimiento, loan ADOPTA el que ya llegó—, marca manual, edición
// y cierre del plan.
// Corre con: node --test arch/v1/application/finance-use-cases/installment.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type {
  Account,
  AccountRepository,
  Category,
  CategoryRepository,
  Transaction,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts"
import {
  type InstallmentPlan,
  type InstallmentPlanRepository,
  type LinkCandidate,
  type LoanPayment,
  type NewInstallmentPlan,
  InstallmentAccountMismatchError,
  InstallmentItemAlreadySettledError,
  InstallmentSplitMismatchError,
  InvalidInstallmentPlanError,
} from "../../domain/finance/installment.domain.ts"
import {
  adoptLoanInstallment,
  createInstallmentPlan,
  executeCardInstallments,
  linkTransactionToItem,
  payInstallmentManually,
  unlinkTransactionFromItem,
  updateInstallmentItem,
} from "./installment-use-cases.ts"

const clp = (n: number) => Money.fromMinor(n, "CLP")
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

// --- Dobles ---

function makeAccounts(type: Account["accountType"] = "credit_card"): AccountRepository {
  const account = {
    id: "acc1",
    userId: "u1",
    accountType: type,
    currency: "CLP",
  } as Account
  return { findById: async (id) => (id === "acc1" ? account : null) } as AccountRepository
}

const categories = {
  findById: async (id: string) =>
    id === "cat1"
      ? ({ id: "cat1", userId: "u1", type: "expense" } as Category)
      : null,
} as CategoryRepository

type Registered = { itemId: string; date: Date; amount: Money }

// Repo en memoria que respeta la regla que en producción impone el único de BD: un ítem tiene a lo
// sumo un movimiento.
function makeRepo() {
  const plans = new Map<string, InstallmentPlan>()
  const registered: Registered[] = []
  const adopted: { itemId: string; transactionId: string }[] = []
  const neutralized: string[] = []
  let unclaimed: (LoanPayment & { transactionId: string })[] = []
  const candidates: LinkCandidate[] = []
  let seq = 0

  const settle = (planId: string, itemId: string, transactionId: string) => {
    const plan = plans.get(planId)!
    const item = plan.items.find((i) => i.id === itemId)!
    if (item.transactionId || item.paidOutsideApp) return false
    item.transactionId = transactionId
    return true
  }

  const repo: InstallmentPlanRepository = {
    listByUser: async (userId) =>
      [...plans.values()].filter((p) => p.userId === userId),
    listActiveByAccount: async (accountId, kind) =>
      [...plans.values()].filter(
        (p) =>
          p.accountId === accountId && p.kind === kind && p.completedAt === null
      ),
    findById: async (id) => plans.get(id) ?? null,
    create: async (input: NewInstallmentPlan, items) => {
      const id = `p${++seq}`
      const plan: InstallmentPlan = {
        ...input,
        id,
        currency: input.totalAmount.currency,
        completedAt: null,
        items: items.map((i) => ({
          ...i,
          id: `${id}-i${i.index}`,
          transactionId: null,
          paidOutsideApp: false,
        })),
      }
      plans.set(id, plan)
      return plan
    },
    delete: async (id) => void plans.delete(id),
    registerItemTransaction: async (plan, itemId, date, amount) => {
      const ok = settle(plan.id, itemId, `tx-${itemId}`)
      if (ok) registered.push({ itemId, date, amount })
      return ok
    },
    adoptTransaction: async (plan, itemId, transactionId) => {
      const ok = settle(plan.id, itemId, transactionId)
      if (ok) adopted.push({ itemId, transactionId })
      return ok
    },
    markPaidOutsideApp: async (itemIds) => {
      for (const plan of plans.values())
        for (const item of plan.items)
          if (itemIds.includes(item.id)) item.paidOutsideApp = true
    },
    updateItem: async (itemId, dueDate, amount) => {
      for (const plan of plans.values())
        for (const item of plan.items)
          if (item.id === itemId) Object.assign(item, { dueDate, amount })
    },
    markCompleted: async (planId, at) => {
      plans.get(planId)!.completedAt = at
    },
    reopen: async (planId) => {
      plans.get(planId)!.completedAt = null
    },
    listLinkCandidates: async () => candidates,
    unlinkTransaction: async (transactionId) => {
      for (const plan of plans.values())
        for (const item of plan.items)
          if (item.transactionId === transactionId) item.transactionId = null
    },
    neutralizeSourceTransaction: async (planId, transactionId) => {
      neutralized.push(transactionId)
      plans.get(planId)!.sourceTransactionId = transactionId
    },
    listUnclaimedLoanPayments: async () => unclaimed,
  }

  return {
    repo,
    registered,
    adopted,
    neutralized,
    plans,
    setUnclaimed: (p: (LoanPayment & { transactionId: string })[]) =>
      (unclaimed = p),
  }
}

const baseInput = {
  kind: "card" as const,
  accountId: "acc1",
  categoryId: "cat1",
  description: "Notebook",
  totalAmount: 600_000,
  installmentsCount: 6,
  startDate: day(2026, 8, 5),
  dayOfMonth: 5,
  tolerancePct: 10,
}

// --- Alta ---

test("crear un plan genera el cronograma completo", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  assert.equal(plan.items.length, 6)
  assert.equal(plan.items[0].amount.toMajor(), 100_000)
  assert.deepEqual(
    plan.items.map((i) => i.dueDate.getMonth() + 1),
    [8, 9, 10, 11, 12, 1]
  )
})

test("un plan card sobre cuenta corriente se rechaza", async () => {
  const { repo } = makeRepo()
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  await assert.rejects(
    () => createInstallmentPlan(deps, "u1", baseInput),
    InstallmentAccountMismatchError
  )
})

test("un plan loan sobre cuenta corriente se acepta", async () => {
  const { repo } = makeRepo()
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    kind: "loan",
  })
  assert.equal(plan.kind, "loan")
})

test("en card, montos que no suman el total se rechazan", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  await assert.rejects(
    () =>
      createInstallmentPlan(deps, "u1", {
        ...baseInput,
        installmentsCount: 3,
        totalAmount: 300_000,
        amounts: [120_000, 100_000, 100_000],
      }),
    InstallmentSplitMismatchError
  )
})

test("en loan el cronograma es estimación y no se exige que sume el total", async () => {
  const { repo } = makeRepo()
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    kind: "loan",
    installmentsCount: 3,
    totalAmount: 300_000,
    amounts: [120_000, 100_000, 100_000],
  })
  assert.equal(plan.items[0].amount.toMajor(), 120_000)
})

test("transformar una compra la neutraliza", async () => {
  const { repo, neutralized } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    sourceTransactionId: "compra1",
  })
  assert.deepEqual(neutralized, ["compra1"])
})

test("en card, las cuotas ya pagadas se registran en SU mes, no en el de creación", async () => {
  const { repo, registered } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    installmentsCount: 6,
    startDate: day(2026, 5, 5),
    paidIndexes: [1, 2, 3],
  })
  assert.deepEqual(
    registered.map((r) => r.date.getMonth() + 1),
    [5, 6, 7]
  )
})

test("en loan, las cuotas ya pagadas adoptan el movimiento importado de su mes", async () => {
  const { repo, adopted, registered, setUnclaimed } = makeRepo()
  setUnclaimed([
    {
      transactionId: "tx-mayo",
      accountId: "acc1",
      amount: clp(100_000),
      date: day(2026, 5, 7),
      installmentNumber: 1,
    },
  ])
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    kind: "loan",
    startDate: day(2026, 5, 5),
    paidIndexes: [1],
  })
  assert.deepEqual(
    adopted.map((a) => a.transactionId),
    ["tx-mayo"]
  )
  assert.equal(registered.length, 0, "loan nunca crea movimientos")
})

test("las cuotas previas a la conexión quedan pagadas fuera de la app, sin gasto", async () => {
  const { repo, registered, adopted } = makeRepo()
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    kind: "loan",
    startDate: day(2026, 5, 5),
    paidIndexes: [1, 2],
  })
  assert.equal(registered.length, 0)
  assert.equal(adopted.length, 0)
  assert.deepEqual(
    plan.items.slice(0, 2).map((i) => i.paidOutsideApp),
    [true, true]
  )
})

// --- Disparador de tarjeta ---

test("el pago de la tarjeta registra una cuota por plan", async () => {
  const { repo, registered } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  await createInstallmentPlan(deps, "u1", baseInput)
  await createInstallmentPlan(deps, "u1", { ...baseInput, description: "Otro" })
  const n = await executeCardInstallments({ installments: repo }, "acc1", day(2026, 9, 3))
  assert.equal(n, 2)
  assert.equal(registered.length, 2)
})

test("dos cuotas atrasadas se saldan de a una, un pago cada vez", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 10, 3))
  assert.equal(repo === repo, true)
  const after = (await repo.findById(plan.id))!
  assert.equal(after.items.filter((i) => i.transactionId).length, 1)
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 10, 20))
  const after2 = (await repo.findById(plan.id))!
  assert.equal(after2.items.filter((i) => i.transactionId).length, 2)
})

test("reprocesar el mismo pago no duplica la cuota", async () => {
  const { repo, registered } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  await createInstallmentPlan(deps, "u1", { ...baseInput, installmentsCount: 1 })
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 9, 3))
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 9, 3))
  assert.equal(registered.length, 1)
})

test("un pago de otra cuenta no registra nada", async () => {
  const { repo, registered } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  await createInstallmentPlan(deps, "u1", baseInput)
  await executeCardInstallments({ installments: repo }, "otra", day(2026, 9, 3))
  assert.equal(registered.length, 0)
})

test("el plan se cierra al registrar su última cuota y deja de esperar pagos", async () => {
  const { repo, registered } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    installmentsCount: 1,
    totalAmount: 100_000,
  })
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 9, 3))
  assert.notEqual((await repo.findById(plan.id))!.completedAt, null)
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 10, 3))
  assert.equal(registered.length, 1)
})

// --- Disparador de crédito ---

test("la cuota de crédito se adopta sin crear movimiento", async () => {
  const { repo, adopted, registered } = makeRepo()
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  await createInstallmentPlan(deps, "u1", { ...baseInput, kind: "loan" })
  const plan = await adoptLoanInstallment(
    { installments: repo },
    {
      transactionId: "tx1",
      accountId: "acc1",
      amount: clp(100_000),
      date: day(2026, 8, 7),
      installmentNumber: null,
    }
  )
  assert.ok(plan)
  assert.deepEqual(adopted, [{ itemId: `${plan!.id}-i1`, transactionId: "tx1" }])
  assert.equal(registered.length, 0)
})

test("una última cuota muy distinta al cronograma se adopta igual y cierra el plan", async () => {
  const { repo } = makeRepo()
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  const created = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    kind: "loan",
    installmentsCount: 1,
    totalAmount: 100_000,
  })
  const plan = await adoptLoanInstallment(
    { installments: repo },
    {
      transactionId: "tx1",
      accountId: "acc1",
      amount: clp(43_120), // muy fuera de la tolerancia del estimado
      date: day(2026, 8, 7),
      installmentNumber: null,
    }
  )
  assert.ok(plan, "un plan único no se descarta por el monto")
  assert.notEqual((await repo.findById(created.id))!.completedAt, null)
})

test("sin plan de esa cuenta, la cuota queda como gasto suelto", async () => {
  const { repo, adopted } = makeRepo()
  const plan = await adoptLoanInstallment(
    { installments: repo },
    {
      transactionId: "tx1",
      accountId: "acc1",
      amount: clp(100_000),
      date: day(2026, 8, 7),
      installmentNumber: null,
    }
  )
  assert.equal(plan, null)
  assert.equal(adopted.length, 0)
})

// --- Marca manual y edición ---

test("una cuota se puede registrar a mano cuando el pago no llega por correo", async () => {
  const { repo, registered } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  const after = await payInstallmentManually({ installments: repo }, "u1", {
    planId: plan.id,
    itemId: plan.items[0].id,
    date: day(2026, 9, 3),
    amount: 100_000,
  })
  assert.equal(registered.length, 1)
  assert.notEqual(after.items[0].transactionId, null)
})

test("si el correo llega después de la marca manual, el ítem no se registra dos veces", async () => {
  const { repo, registered, adopted } = makeRepo()
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    kind: "loan",
  })
  await payInstallmentManually({ installments: repo }, "u1", {
    planId: plan.id,
    itemId: plan.items[0].id,
    date: day(2026, 8, 6),
    amount: 100_000,
  })
  const claimed = await adoptLoanInstallment(
    { installments: repo },
    {
      transactionId: "tx-tarde",
      accountId: "acc1",
      amount: clp(100_000),
      date: day(2026, 8, 7),
      installmentNumber: 1,
    }
  )
  assert.equal(registered.length, 1)
  assert.equal(adopted.length, 0, "no se engancha a ninguna cuota")
  assert.equal(claimed, null, "el movimiento queda como gasto suelto")
})

// --- Asignar un movimiento existente ---

// Doble de TransactionRepository con lo que usa el caso de uso.
function makeTransactions(
  rows: Record<string, Partial<Transaction>> = {}
): TransactionRepository {
  return {
    findById: async (id: string) =>
      rows[id]
        ? ({
            id,
            userId: "u1",
            direction: "debit",
            date: day(2026, 8, 7),
            amount: clp(100_000),
            installmentItemId: null,
            ...rows[id],
          } as Transaction)
        : null,
  } as TransactionRepository
}

test("asignar un movimiento existente NO crea otro", async () => {
  const { repo, adopted, registered } = makeRepo()
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    kind: "loan",
  })
  const after = await linkTransactionToItem(
    { installments: repo, transactions: makeTransactions({ tx1: {} }) },
    "u1",
    { planId: plan.id, itemId: plan.items[0].id, transactionId: "tx1" }
  )
  assert.equal(registered.length, 0, "asignar nunca fabrica un gasto")
  assert.deepEqual(adopted, [{ itemId: plan.items[0].id, transactionId: "tx1" }])
  assert.equal(after.items[0].transactionId, "tx1")
})

test("no se puede asignar un movimiento que ya es cuota de otro plan", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  await assert.rejects(
    () =>
      linkTransactionToItem(
        {
          installments: repo,
          transactions: makeTransactions({ tx1: { installmentItemId: "otro" } }),
        },
        "u1",
        { planId: plan.id, itemId: plan.items[0].id, transactionId: "tx1" }
      ),
    InvalidInstallmentPlanError
  )
})

test("un ingreso no puede asignarse como cuota", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  await assert.rejects(
    () =>
      linkTransactionToItem(
        {
          installments: repo,
          transactions: makeTransactions({ tx1: { direction: "credit" } }),
        },
        "u1",
        { planId: plan.id, itemId: plan.items[0].id, transactionId: "tx1" }
      ),
    InvalidInstallmentPlanError
  )
})

test("una cuota ya registrada no admite otra asignación", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 9, 3))
  await assert.rejects(
    () =>
      linkTransactionToItem(
        { installments: repo, transactions: makeTransactions({ tx1: {} }) },
        "u1",
        { planId: plan.id, itemId: plan.items[0].id, transactionId: "tx1" }
      ),
    InstallmentItemAlreadySettledError
  )
})

test("soltar la cuota la deja pendiente y reabre el plan cerrado", async () => {
  const { repo } = makeRepo()
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    kind: "loan",
    installmentsCount: 1,
    totalAmount: 100_000,
  })
  await linkTransactionToItem(
    { installments: repo, transactions: makeTransactions({ tx1: {} }) },
    "u1",
    { planId: plan.id, itemId: plan.items[0].id, transactionId: "tx1" }
  )
  assert.notEqual((await repo.findById(plan.id))!.completedAt, null)

  const after = await unlinkTransactionFromItem({ installments: repo }, "u1", {
    planId: plan.id,
    itemId: plan.items[0].id,
  })
  assert.equal(after.items[0].transactionId, null)
  assert.equal(after.completedAt, null, "vuelve a esperar pagos")
})

test("una cuota ya registrada no se puede editar", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 9, 3))
  await assert.rejects(
    () =>
      updateInstallmentItem({ installments: repo }, "u1", {
        planId: plan.id,
        itemId: plan.items[0].id,
        dueDate: day(2026, 8, 10),
        amount: 120_000,
      }),
    InstallmentItemAlreadySettledError
  )
})

test("editar una cuota de card rompiendo el total se rechaza", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  await assert.rejects(
    () =>
      updateInstallmentItem({ installments: repo }, "u1", {
        planId: plan.id,
        itemId: plan.items[0].id,
        dueDate: day(2026, 8, 10),
        amount: 120_000,
      }),
    InstallmentSplitMismatchError
  )
})
