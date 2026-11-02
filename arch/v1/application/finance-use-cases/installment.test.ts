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
  InstallmentCategoryRequiredError,
  InstallmentItemAlreadySettledError,
  InstallmentSplitMismatchError,
  InvalidInstallmentPlanError,
  progress as progressOf,
} from "../../domain/finance/installment.domain.ts"
import {
  adoptLoanInstallment,
  createInstallmentPlan,
  deleteInstallmentPlan,
  executeCardInstallments,
  linkTransactionToItem,
  payInstallmentManually,
  setInstallmentPlanCategory,
  unlinkTransactionFromItem,
  updateInstallmentItem,
} from "./installment-use-cases.ts"
import { categorizeTransaction } from "./categorize-transaction-use-case.ts"
import * as installmentUseCases from "./installment-use-cases.ts"
import { listInstallmentsView } from "./finance-read.ts"
import { NotOwnerError } from "../../domain/finance/finance.domain.ts"

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
  const restored: string[] = [] // compras origen des-neutralizadas al borrar el plan
  const recategorized: { planId: string; categoryId: string }[] = []
  let unclaimed: (LoanPayment & { transactionId: string })[] = []
  const candidates: LinkCandidate[] = []
  // Categoría que el repo le aplica a cada movimiento adoptado (la del plan).
  const txCategory = new Map<string, string>()
  let seq = 0

  const settle = (planId: string, itemId: string, transactionId: string) => {
    const plan = plans.get(planId)!
    const item = plan.items.find((i) => i.id === itemId)!
    if (item.transactionId || item.paidOutsideApp) return false
    item.transactionId = transactionId
    return true
  }

  // WDC-120: `moveItemTransaction` es el puerto propuesto para mover un pago de una cuota a otra en
  // una sola transacción de base. Opcional aquí para no romper la compilación antes de que exista.
  const repo: InstallmentPlanRepository & Partial<{
    moveItemTransaction(
      transactionId: string,
      to: { plan: InstallmentPlan; itemId: string } | null
    ): Promise<void>
  }> = {
    listByUser: async (userId) =>
      [...plans.values()].filter((p) => p.userId === userId),
    listActiveByAccount: async (accountId, kind) =>
      [...plans.values()].filter(
        (p) =>
          p.accountId === accountId && p.kind === kind && p.completedAt === null
      ),
    findById: async (id) => plans.get(id) ?? null,
    findByTransaction: async (transactionId) =>
      [...plans.values()].find(
        (p) =>
          p.sourceTransactionId === transactionId ||
          p.items.some((i) => i.transactionId === transactionId)
      ) ?? null,
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
    delete: async (id, restoreSourceTransactionId = null) => {
      if (restoreSourceTransactionId) restored.push(restoreSourceTransactionId)
      plans.delete(id)
    },
    registerItemTransaction: async (plan, itemId, date, amount) => {
      const ok = settle(plan.id, itemId, `tx-${itemId}`)
      if (ok) registered.push({ itemId, date, amount })
      return ok
    },
    adoptTransaction: async (plan, itemId, transactionId) => {
      const ok = settle(plan.id, itemId, transactionId)
      if (ok) {
        adopted.push({ itemId, transactionId })
        txCategory.set(transactionId, plan.categoryId)
      }
      return ok
    },
    moveItemTransaction: async (transactionId, to) => {
      const target = to
        ? plans.get(to.plan.id)!.items.find((i) => i.id === to.itemId)!
        : null
      if (target && (target.transactionId || target.paidOutsideApp))
        throw new InstallmentItemAlreadySettledError()
      for (const plan of plans.values())
        for (const item of plan.items)
          if (item.transactionId === transactionId) item.transactionId = null
      if (to && target) {
        target.transactionId = transactionId
        txCategory.set(transactionId, to.plan.categoryId)
      }
    },
    markPaidOutsideApp: async (itemIds) => {
      for (const plan of plans.values())
        for (const item of plan.items)
          if (itemIds.includes(item.id)) item.paidOutsideApp = true
    },
    updateItems: async (updates) => {
      for (const u of updates)
        for (const plan of plans.values())
          for (const item of plan.items)
            if (item.id === u.itemId)
              Object.assign(item, {
                amount: u.amount,
                ...(u.dueDate ? { dueDate: u.dueDate } : {}),
              })
    },
    setCategory: async (planId, categoryId) => {
      recategorized.push({ planId, categoryId })
      plans.get(planId)!.categoryId = categoryId
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
    restored,
    recategorized,
    plans,
    txCategory,
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

// Caso real, tomado del cronograma en PDF de Banco de Chile (22/07/2026): lista las cuotas 4 a 48
// —45 filas—, de 265.708 y la última de 265.737, con la 4 venciendo el 05/08/2026. Las tres cifras
// del panel del banco confirman esa lectura: plazo pendiente 45, saldo 11.956.889 (= la suma de
// esas 45) y próximo pago 05/08/2026.
const CREDITO_REAL = {
  installmentsCount: 48,
  startIndex: 4,
  totalAmount: 11_956_889,
  startDate: day(2026, 8, 5),
  dayOfMonth: 5,
}

test("un crédito dado de alta a mitad conserva la numeración del banco", async () => {
  const { repo } = makeRepo()
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    ...CREDITO_REAL,
    kind: "loan",
    description: "Crédito de consumo",
  })

  // Las cuotas 1–3 ya se pagaron antes de que existiera el plan.
  assert.deepEqual(
    plan.items.slice(0, 3).map((i) => i.paidOutsideApp),
    [true, true, true]
  )
  assert.deepEqual(progressOf(plan), { settled: 3, total: 48 })

  // La cuota 4 vence el 05/08/2026 y vale lo que dice el banco.
  const cuarta = plan.items[3]
  assert.equal(cuarta.index, 4)
  assert.equal(cuarta.dueDate.getMonth() + 1, 8)
  assert.equal(cuarta.dueDate.getFullYear(), 2026)
  assert.equal(cuarta.amount.toMajor(), 265_708)

  // La última es la 48, vence en abril de 2030 y absorbe el resto: 265.737.
  const ultima = plan.items[47]
  assert.equal(ultima.index, 48)
  assert.equal(ultima.dueDate.getMonth() + 1, 4)
  assert.equal(ultima.dueDate.getFullYear(), 2030)
  assert.equal(ultima.amount.toMajor(), 265_737)

  // 45 cuotas pendientes que suman exactamente el saldo informado.
  const pendientes = plan.items.slice(3)
  assert.equal(pendientes.length, 45)
  assert.equal(
    pendientes.reduce((s, i) => s + i.amount.toMajor(), 0),
    11_956_889
  )
})

test("un correo que informa el N° de cuota del banco cae en el ítem correcto", async () => {
  const { repo, adopted } = makeRepo()
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    ...CREDITO_REAL,
    kind: "loan",
  })
  await adoptLoanInstallment(
    { installments: repo },
    {
      transactionId: "tx5",
      accountId: "acc1",
      amount: clp(265_708),
      date: day(2026, 9, 7),
      installmentNumber: 5, // el banco numera 5, no "la segunda del plan"
    }
  )
  assert.deepEqual(adopted, [{ itemId: `${plan.id}-i5`, transactionId: "tx5" }])
})

test("un desfase mal puesto deja el pago sin enganchar, no lo mete en la cuota vecina", async () => {
  // Registrar el crédito como "5 de 49" (lo que dice el panel) en vez de "4 de 48" (lo que dice el
  // cronograma): el correo de la cuota 4 no encuentra dónde ir, porque la 4 quedó dada por pagada.
  const { repo, adopted } = makeRepo()
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    kind: "loan",
    installmentsCount: 49,
    startIndex: 5,
    totalAmount: 11_956_889,
    startDate: day(2026, 8, 5),
  })
  const claimed = await adoptLoanInstallment(
    { installments: repo },
    {
      transactionId: "tx4",
      accountId: "acc1",
      amount: clp(265_708),
      date: day(2026, 8, 5),
      installmentNumber: 4,
    }
  )
  assert.equal(claimed, null)
  assert.equal(adopted.length, 0, "no se inventa un enganche en la cuota 5")
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

test("rechaza generar una cuota cuyo vencimiento aún es futuro", async () => {
  const { repo, registered } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const future = new Date()
  future.setFullYear(future.getFullYear() + 1)
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    startDate: future,
  })
  await assert.rejects(
    () => payInstallmentManually({ installments: repo }, "u1", {
      planId: plan.id,
      itemId: plan.items[0].id,
      date: future,
      amount: 100_000,
    }),
    InvalidInstallmentPlanError
  )
  assert.equal(registered.length, 0)
  assert.equal(plan.items[0].transactionId, null)
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
            accountId: "acc1",
            description: "Pago cuota crédito de consumo",
            direction: "debit",
            isInternal: false,
            date: day(2026, 8, 7),
            amount: clp(100_000),
            installmentItemId: null,
            ...rows[id],
          } as Transaction)
        : null,
    setCategory: async (id: string, categoryId: string | null) =>
      ({ id, categoryId }) as unknown as Transaction,
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

test("una cuota loan ya registrada no se puede editar: su monto y fecha los fijó el correo", async () => {
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
  await linkTransactionToItem(
    { installments: repo, transactions: makeTransactions({ tx1: {} }) },
    "u1",
    { planId: plan.id, itemId: plan.items[0].id, transactionId: "tx1" }
  )
  await assert.rejects(
    () =>
      updateInstallmentItem({ installments: repo }, "u1", {
        planId: plan.id,
        itemId: plan.items[0].id,
        dueDate: day(2026, 8, 10),
        amount: 100_000,
      }),
    InstallmentItemAlreadySettledError
  )
})

test("una cuota card ya registrada SÍ se edita: el movimiento es un espejo del cronograma", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 9, 3))

  // Mismo monto (Σ = total se mantiene), nueva fecha: la edición pasa y el repo sincroniza el
  // movimiento (verificado en infra; aquí basta que el use-case ya no la rechace).
  const after = await updateInstallmentItem({ installments: repo }, "u1", {
    planId: plan.id,
    itemId: plan.items[0].id,
    dueDate: day(2026, 8, 20),
    amount: 100_000,
  })
  assert.equal(after.items[0].dueDate.getDate(), 20)
  assert.notEqual(after.items[0].transactionId, null, "sigue registrada")
})

test("editar el monto de una cuota card redistribuye las pendientes manteniendo el total", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  const after = await updateInstallmentItem({ installments: repo }, "u1", {
    planId: plan.id,
    itemId: plan.items[0].id,
    dueDate: day(2026, 8, 10),
    amount: 120_000,
  })
  assert.equal(after.items[0].amount.toMajor(), 120_000)
  assert.deepEqual(
    after.items.slice(1).map((i) => i.amount.toMajor()),
    [96_000, 96_000, 96_000, 96_000, 96_000]
  )
  const sum = after.items.reduce((s, i) => s + i.amount.toMajor(), 0)
  assert.equal(sum, 600_000, "el total del plan no se negocia")
})

test("la redistribución no toca las cuotas ya saldadas", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  // La cuota 1 queda registrada: su movimiento ya vivió su mes.
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 9, 3))
  const after = await updateInstallmentItem({ installments: repo }, "u1", {
    planId: plan.id,
    itemId: plan.items[2].id,
    dueDate: day(2026, 10, 5),
    amount: 150_000,
  })
  assert.equal(after.items[0].amount.toMajor(), 100_000, "la saldada no se mueve")
  assert.equal(after.items[2].amount.toMajor(), 150_000)
  // 600k − 100k (saldada) − 150k (editada) = 350k entre las 4 pendientes restantes.
  assert.deepEqual(
    [1, 3, 4, 5].map((n) => after.items[n].amount.toMajor()),
    [87_500, 87_500, 87_500, 87_500]
  )
})

test("un monto que no deja saldo para las pendientes se rechaza", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  await assert.rejects(
    () =>
      updateInstallmentItem({ installments: repo }, "u1", {
        planId: plan.id,
        itemId: plan.items[0].id,
        dueDate: day(2026, 8, 10),
        amount: 600_000,
      }),
    InvalidInstallmentPlanError
  )
})

test("con una sola pendiente el monto debe cuadrar el total", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    installmentsCount: 2,
    totalAmount: 200_000,
  })
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 9, 3))
  await assert.rejects(
    () =>
      updateInstallmentItem({ installments: repo }, "u1", {
        planId: plan.id,
        itemId: plan.items[1].id,
        dueDate: day(2026, 9, 5),
        amount: 90_000,
      }),
    InstallmentSplitMismatchError
  )
})

test("cambiar solo la fecha no redistribuye montos personalizados", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    installmentsCount: 3,
    totalAmount: 300_000,
    amounts: [120_000, 90_000, 90_000],
  })
  const after = await updateInstallmentItem({ installments: repo }, "u1", {
    planId: plan.id,
    itemId: plan.items[0].id,
    dueDate: day(2026, 8, 20),
    amount: 120_000, // mismo monto: solo se mueve la fecha
  })
  assert.equal(after.items[0].dueDate.getDate(), 20)
  assert.deepEqual(
    after.items.map((i) => i.amount.toMajor()),
    [120_000, 90_000, 90_000],
    "los montos configurados a mano quedan como estaban"
  )
})

// --- Borrado ---

test("borrar un plan card sin cuotas registradas des-neutraliza la compra origen", async () => {
  const { repo, restored } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    sourceTransactionId: "compra1",
  })
  await deleteInstallmentPlan({ installments: repo }, "u1", plan.id)
  assert.deepEqual(restored, ["compra1"], "el gasto vuelve a contar en su mes")
})

test("borrar un plan card con cuotas registradas conserva la neutralización", async () => {
  const { repo, restored } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    sourceTransactionId: "compra1",
  })
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 9, 3))
  await deleteInstallmentPlan({ installments: repo }, "u1", plan.id)
  assert.deepEqual(
    restored,
    [],
    "parte del gasto ya vive en las cuotas: des-neutralizar lo contaría dos veces"
  )
})

// --- Categoría: es del plan, se propaga completa ---

test("recategorizar el plan valida la categoría y recategoriza el conjunto", async () => {
  const { repo, recategorized } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  await setInstallmentPlanCategory(
    { installments: repo, categories },
    "u1",
    { planId: plan.id, categoryId: "cat1" }
  )
  assert.deepEqual(recategorized, [{ planId: plan.id, categoryId: "cat1" }])
})

test("un plan de cuotas no acepta una categoría de ingreso", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  const cats = {
    findById: async (id: string) =>
      id === "catIn"
        ? ({ id, userId: "u1", type: "income" } as Category)
        : null,
  } as CategoryRepository
  await assert.rejects(
    () =>
      setInstallmentPlanCategory(
        { installments: repo, categories: cats },
        "u1",
        { planId: plan.id, categoryId: "catIn" }
      ),
    InvalidInstallmentPlanError
  )
})

test("recategorizar la compra origen recategoriza el plan completo", async () => {
  const { repo, recategorized } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    sourceTransactionId: "compra1",
  })
  await categorizeTransaction(
    {
      transactions: makeTransactions({ compra1: {} }),
      categories,
      installments: repo,
    },
    "u1",
    "compra1",
    "cat1"
  )
  assert.deepEqual(recategorized, [{ planId: plan.id, categoryId: "cat1" }])
})

test("recategorizar una cuota registrada recategoriza el plan completo", async () => {
  const { repo, recategorized } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 9, 3))
  const txId = (await repo.findById(plan.id))!.items[0].transactionId!
  await categorizeTransaction(
    {
      transactions: makeTransactions({ [txId]: {} }),
      categories,
      installments: repo,
    },
    "u1",
    txId,
    "cat1"
  )
  assert.deepEqual(recategorized, [{ planId: plan.id, categoryId: "cat1" }])
})

test("recategorizar la cuota adoptada de un loan recategoriza el crédito completo", async () => {
  const { repo, recategorized } = makeRepo()
  const deps = {
    installments: repo,
    accounts: makeAccounts("checking"),
    categories,
  }
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    kind: "loan",
  })
  await linkTransactionToItem(
    { installments: repo, transactions: makeTransactions({ tx1: {} }) },
    "u1",
    { planId: plan.id, itemId: plan.items[0].id, transactionId: "tx1" }
  )
  await categorizeTransaction(
    {
      transactions: makeTransactions({ tx1: {} }),
      categories,
      installments: repo,
    },
    "u1",
    "tx1",
    "cat1"
  )
  assert.deepEqual(recategorized, [{ planId: plan.id, categoryId: "cat1" }])
})

test("un movimiento de un plan no puede quedar sin categoría", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    sourceTransactionId: "compra1",
  })
  await assert.rejects(
    () =>
      categorizeTransaction(
        {
          transactions: makeTransactions({ compra1: {} }),
          categories,
          installments: repo,
        },
        "u1",
        "compra1",
        null
      ),
    InstallmentCategoryRequiredError
  )
})


for (const kind of ["card", "loan"] as const) {
  test(`${kind}: genera desde el cronograma sin correo y rechaza repetir la cuota`, async () => {
    const { repo, registered } = makeRepo()
    const deps = {
      installments: repo,
      accounts: makeAccounts(kind === "card" ? "credit_card" : "checking"),
      categories,
    }
    const plan = await createInstallmentPlan(deps, "u1", { ...baseInput, kind })
    const item = plan.items[0]
    const input = {
      planId: plan.id,
      itemId: item.id,
      date: item.dueDate,
      amount: item.amount.toMajor(),
    }
    const after = await payInstallmentManually(deps, "u1", input)
    assert.ok(after.items[0].transactionId)
    assert.equal(registered.length, 1)
    assert.equal(registered[0].date.getTime(), item.dueDate.getTime())
    assert.equal(registered[0].amount.toMajor(), item.amount.toMajor())
    await assert.rejects(
      payInstallmentManually(deps, "u1", input),
      InstallmentItemAlreadySettledError
    )
    assert.equal(registered.length, 1)
  })
}

// --- WDC-120: créditos que se cruzan en la misma cuenta ---

// Alta del Crédito Consumo (cuotas de $100.000, 10% de tolerancia) marcando pagada la cuota de mayo,
// con `pagos` ya importados ese mes y, opcional, otro crédito activo en la cuenta con cuotas de `otro`.
async function altaConPagosDelMes(pagos: number[], otro?: number) {
  const { repo, adopted, setUnclaimed } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts("checking"), categories }
  if (otro)
    await createInstallmentPlan(deps, "u1", {
      ...baseInput,
      kind: "loan",
      description: "Viaje Jo Ch - T",
      totalAmount: otro * 6,
      startDate: day(2026, 5, 5),
    })
  setUnclaimed(
    pagos.map((monto, i) => ({
      transactionId: `tx-${monto}`,
      accountId: "acc1",
      amount: clp(monto),
      date: day(2026, 5, 7 + i),
      installmentNumber: null,
    }))
  )
  const plan = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    kind: "loan",
    description: "Crédito Consumo",
    startDate: day(2026, 5, 5),
    paidIndexes: [1],
  })
  return {
    adoptados: adopted.map((a) => a.transactionId),
    fueraDeLaApp: plan.items[0].paidOutsideApp,
  }
}

test("Dado que creo el Crédito Consumo ($100.000 por cuota, 10% de tolerancia) marcando pagada la cuota de mayo, cuando ese mes solo hay un pago que no calza con la cuota, entonces no lo toma y la cuota queda pagada fuera de la app", async () => {
  assert.deepEqual(await altaConPagosDelMes([53_450]), {
    adoptados: [],
    fueraDeLaApp: true,
  })
  // Si en el mes también está el pago que sí calza, toma ese y no el primero.
  assert.deepEqual((await altaConPagosDelMes([53_450, 104_000])).adoptados, ["tx-104000"])
  // Bordes de la tolerancia: $90.000 y $110.000 calzan; un peso fuera, no.
  assert.deepEqual((await altaConPagosDelMes([110_000])).adoptados, ["tx-110000"])
  assert.deepEqual(await altaConPagosDelMes([110_001]), { adoptados: [], fueraDeLaApp: true })
  assert.deepEqual((await altaConPagosDelMes([90_000])).adoptados, ["tx-90000"])
  assert.deepEqual(await altaConPagosDelMes([89_999]), { adoptados: [], fueraDeLaApp: true })
})

test("Dado otro crédito activo en la cuenta con cuotas de $108.000, cuando creo uno de $100.000 marcando pagada la cuota de mayo y el pago del mes está más cerca del otro, entonces no lo toma y la cuota queda pagada fuera de la app", async () => {
  assert.deepEqual(await altaConPagosDelMes([107_000], 108_000), {
    adoptados: [],
    fueraDeLaApp: true,
  })
  assert.deepEqual((await altaConPagosDelMes([103_000], 108_000)).adoptados, ["tx-103000"])
  // A igual distancia de los dos ($104.000) no es «más cercano al otro»: lo toma.
  assert.deepEqual((await altaConPagosDelMes([104_000], 108_000)).adoptados, ["tx-104000"])
})

test("Dado un crédito en CLP, cuando asigno a mano un movimiento en otra moneda o interno, entonces se rechaza con un mensaje en español y la cuota sigue pendiente; uno de otra cuenta sí se acepta", async () => {
  const casos: [Partial<Transaction>, RegExp][] = [
    [{ amount: Money.fromMinor(10_000, "USD") }, /moneda/i],
    [{ isInternal: true }, /intern|transferencia/i],
  ]
  for (const [movimiento, mensaje] of casos) {
    const { repo, adopted } = makeRepo()
    const deps = { installments: repo, accounts: makeAccounts("checking"), categories }
    const plan = await createInstallmentPlan(deps, "u1", { ...baseInput, kind: "loan" })
    await assert.rejects(
      () =>
        linkTransactionToItem(
          { installments: repo, transactions: makeTransactions({ tx1: movimiento }) },
          "u1",
          { planId: plan.id, itemId: plan.items[0].id, transactionId: "tx1" }
        ),
      (error: unknown) =>
        error instanceof InvalidInstallmentPlanError && mensaje.test(error.message),
      String(mensaje)
    )
    assert.equal(adopted.length, 0)
    assert.equal((await repo.findById(plan.id))!.items[0].transactionId, null)
  }
  // Una cuota puede pagarse desde otra cuenta: eso no se rechaza.
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts("checking"), categories }
  const plan = await createInstallmentPlan(deps, "u1", { ...baseInput, kind: "loan" })
  const after = await linkTransactionToItem(
    { installments: repo, transactions: makeTransactions({ tx1: { accountId: "acc2" } }) },
    "u1",
    { planId: plan.id, itemId: plan.items[0].id, transactionId: "tx1" }
  )
  assert.equal(after.items[0].transactionId, "tx1")
})

test("Dado un crédito con una cuota pagada por un movimiento, otra pagada fuera de la app y otra pendiente, cuando el chat lista los planes, entonces cada cuota muestra el movimiento que la pagó o nada", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts("checking"), categories }
  const created = await createInstallmentPlan(deps, "u1", {
    ...baseInput,
    kind: "loan",
    installmentsCount: 3,
    totalAmount: 300_000,
  })
  const plan = (await repo.findById(created.id))!
  await repo.adoptTransaction(plan, plan.items[0].id, "tx-1")
  await repo.markPaidOutsideApp([plan.items[1].id])
  const view = await listInstallmentsView(
    {
      installments: repo,
      accounts: { listByUser: async () => [{ id: "acc1", name: "Cuenta corriente" }] } as unknown as AccountRepository,
      categories: { listByUser: async () => [] } as unknown as CategoryRepository,
      transactions: makeTransactions({
        "tx-1": {
          description: "Pago cuota 1 de crédito de consumo",
          amount: clp(101_000),
          date: day(2026, 8, 7),
        },
      }),
    },
    "u1",
    day(2026, 10, 1)
  )
  const items = view[0].items as unknown as Record<string, unknown>[]
  assert.deepEqual(items[0].transaction, {
    id: "tx-1",
    description: "Pago cuota 1 de crédito de consumo",
    amount: 101_000,
    date: day(2026, 8, 7).toISOString(),
  })
  assert.equal(items[1].transaction, null, "pagada fuera de la app: sin movimiento")
  assert.equal(items[2].transaction, null, "pendiente: sin movimiento")
})

// Mover un pago de una cuota a otra. Firma propuesta (aún no existe):
//   moveInstallmentPayment(deps: { installments, transactions }, userId,
//     { planId, itemId, toPlanId?, toItemId? })
type MoveInput = { planId: string; itemId: string; toPlanId?: string; toItemId?: string }
type MoveDeps = { installments: InstallmentPlanRepository; transactions: TransactionRepository }
async function moverPago(deps: MoveDeps, userId: string, input: MoveInput) {
  const move = (installmentUseCases as Record<string, unknown>).moveInstallmentPayment as
    | ((deps: MoveDeps, userId: string, input: MoveInput) => Promise<unknown>)
    | undefined
  assert.ok(move, "falta el caso de uso moveInstallmentPayment")
  return move(deps, userId, input)
}

const CARGO = "tx-265708"

// Caso real: el cargo de $265.708 del Crédito Consumo quedó en la cuota 6 del Viaje Jo.
async function cargoMalEnganchado(movimiento: Partial<Transaction> = {}) {
  const ctx = makeRepo()
  const deps = { installments: ctx.repo, accounts: makeAccounts("checking"), categories }
  const viajeId = (
    await createInstallmentPlan(deps, "u1", {
      ...baseInput,
      kind: "loan",
      description: "Viaje Jo Ch - T",
      totalAmount: 534_500,
      installmentsCount: 10,
      startDate: day(2026, 2, 5),
    })
  ).id
  const creditoId = (
    await createInstallmentPlan(deps, "u1", {
      ...baseInput,
      kind: "loan",
      description: "Crédito Consumo",
      totalAmount: 2_541_560,
      installmentsCount: 10,
      startDate: day(2026, 3, 5),
    })
  ).id
  const viaje = ctx.plans.get(viajeId)!
  const credito = ctx.plans.get(creditoId)!
  credito.categoryId = "cat-credito"
  viaje.items[5].transactionId = CARGO
  ctx.txCategory.set(CARGO, viaje.categoryId)
  const transactions = makeTransactions({
    [CARGO]: {
      description: "Pago cuota 6 de crédito de consumo",
      amount: clp(265_708),
      date: day(2026, 7, 5),
      installmentItemId: viaje.items[5].id,
      ...movimiento,
    },
  })
  return { ...ctx, viaje, credito, deps: { installments: ctx.repo, transactions } }
}

test("Dado el cargo de $265.708 enganchado en la cuota 6 del Viaje Jo, cuando lo muevo a la cuota 5 del Crédito Consumo, entonces la cuota del Viaje vuelve a pendiente y la del Crédito queda pagada con ese mismo movimiento y su categoría", async () => {
  const { deps, viaje, credito, registered, txCategory } = await cargoMalEnganchado()
  await moverPago(deps, "u1", {
    planId: viaje.id,
    itemId: viaje.items[5].id,
    toPlanId: credito.id,
    toItemId: credito.items[4].id,
  })
  assert.equal(viaje.items[5].transactionId, null, "la cuota 6 del Viaje vuelve a pendiente")
  assert.equal(credito.items[4].transactionId, CARGO, "la cuota 5 del Crédito queda con el cargo")
  assert.equal(txCategory.get(CARGO), "cat-credito", "el movimiento toma la categoría del Crédito")
  assert.equal(registered.length, 0, "no crea movimientos")
})

test("Dado un crédito cerrado cuya última cuota tiene un movimiento, cuando suelto ese pago sin destino, entonces la cuota vuelve a pendiente, el plan se reabre y el movimiento queda como gasto suelto", async () => {
  const { deps, viaje, credito } = await cargoMalEnganchado()
  viaje.completedAt = day(2026, 7, 5)
  await moverPago(deps, "u1", { planId: viaje.id, itemId: viaje.items[5].id })
  assert.equal(viaje.items[5].transactionId, null)
  assert.equal(viaje.completedAt, null, "el plan vuelve a esperar pagos")
  assert.equal(
    [viaje, credito].some((p) => p.items.some((i) => i.transactionId === CARGO)),
    false,
    "el movimiento no queda en ninguna cuota"
  )
})

test("Dado el cargo enganchado en el Viaje Jo, cuando lo muevo a una cuota que no lo admite, entonces se rechaza y el cargo sigue en la cuota del Viaje", async () => {
  const casos: {
    nombre: string
    preparar: (c: Awaited<ReturnType<typeof cargoMalEnganchado>>) => void
    movimiento?: Partial<Transaction>
    error: new (...args: never[]) => Error
  }[] = [
    { nombre: "otra moneda", preparar: (c) => (c.credito.currency = "USD"), error: InvalidInstallmentPlanError },
    { nombre: "interno", preparar: () => {}, movimiento: { isInternal: true }, error: InvalidInstallmentPlanError },
    { nombre: "cuota ya pagada", preparar: (c) => (c.credito.items[4].transactionId = "otro"), error: InstallmentItemAlreadySettledError },
    { nombre: "cuota pagada fuera de la app", preparar: (c) => (c.credito.items[4].paidOutsideApp = true), error: InstallmentItemAlreadySettledError },
  ]
  for (const caso of casos) {
    const c = await cargoMalEnganchado(caso.movimiento)
    caso.preparar(c)
    const destinoAntes = c.credito.items[4].transactionId
    await assert.rejects(
      () =>
        moverPago(c.deps, "u1", {
          planId: c.viaje.id,
          itemId: c.viaje.items[5].id,
          toPlanId: c.credito.id,
          toItemId: c.credito.items[4].id,
        }),
      caso.error,
      caso.nombre
    )
    assert.equal(c.viaje.items[5].transactionId, CARGO, `${caso.nombre}: el origen queda como estaba`)
    assert.equal(c.credito.items[4].transactionId, destinoAntes, caso.nombre)
  }
})

test("Dado una cuota sin movimiento (pendiente o pagada fuera de la app), cuando pido mover su pago, entonces se rechaza y nada cambia", async () => {
  const { deps, viaje, credito } = await cargoMalEnganchado()
  viaje.items[0].paidOutsideApp = true
  for (const item of [viaje.items[6], viaje.items[0]]) {
    await assert.rejects(
      () =>
        moverPago(deps, "u1", {
          planId: viaje.id,
          itemId: item.id,
          toPlanId: credito.id,
          toItemId: credito.items[4].id,
        }),
      InvalidInstallmentPlanError
    )
  }
  assert.equal(viaje.items[5].transactionId, CARGO)
  assert.equal(credito.items[4].transactionId, null)
})

test("Dado el cargo enganchado en mi Viaje Jo, cuando el destino es un plan de otra persona o otra persona intenta moverlo, entonces se rechaza y el cargo sigue donde estaba", async () => {
  const { deps, viaje, credito } = await cargoMalEnganchado()
  const pedido = {
    planId: viaje.id,
    itemId: viaje.items[5].id,
    toPlanId: credito.id,
    toItemId: credito.items[4].id,
  }
  await assert.rejects(() => moverPago(deps, "u2", pedido), NotOwnerError)
  credito.userId = "u2"
  await assert.rejects(() => moverPago(deps, "u1", pedido), NotOwnerError)
  assert.equal(viaje.items[5].transactionId, CARGO)
  assert.equal(credito.items[4].transactionId, null)
})

// --- WDC-120 ronda 3 ---

test("Dado el Crédito Consumo (va en la cuota 5) y el Viaje Jo (va en la 6) en la misma cuenta, cuando llega el cargo de $265.708 con correo «cuota 6», entonces queda en la cuota 5 del Crédito; con un solo crédito sigue mandando el N° del correo", async () => {
  const ctx = makeRepo()
  const deps = { installments: ctx.repo, accounts: makeAccounts("checking"), categories }
  const crear = async (description: string, cuota: number, start: Date, pagadas: number) => {
    const { id } = await createInstallmentPlan(deps, "u1", {
      ...baseInput,
      kind: "loan",
      description,
      totalAmount: cuota * 10,
      installmentsCount: 10,
      startDate: start,
    })
    const plan = ctx.plans.get(id)!
    for (let i = 0; i < pagadas; i++) plan.items[i].transactionId = `${id}-t${i + 1}`
    return plan
  }
  const credito = await crear("Crédito Consumo", 254_156, day(2026, 3, 5), 4) // la 5 vence el 5/7
  const viaje = await crear("Viaje Jo Ch - T", 53_450, day(2026, 2, 5), 5) // la 6 vence el 5/7
  const cargo = {
    transactionId: CARGO,
    accountId: "acc1",
    amount: clp(265_708),
    date: day(2026, 7, 5),
    installmentNumber: 6,
  }
  const elegido = await adoptLoanInstallment({ installments: ctx.repo }, cargo)
  assert.equal(elegido?.id, credito.id)
  assert.equal(credito.items[4].transactionId, CARGO, "queda en la cuota 5, la que eligió el plan")
  assert.equal(credito.items[5].transactionId, null, "no en la 6 que nombró el correo")
  assert.equal(viaje.items[5].transactionId, null)

  // Resguardo: con un solo crédito, el N° del correo sigue eligiendo la cuota.
  const solo = makeRepo()
  const soloDeps = { installments: solo.repo, accounts: makeAccounts("checking"), categories }
  const { id } = await createInstallmentPlan(soloDeps, "u1", {
    ...baseInput,
    kind: "loan",
    totalAmount: 2_541_560,
    installmentsCount: 10,
    startDate: day(2026, 3, 5),
  })
  const unico = solo.plans.get(id)!
  for (let i = 0; i < 4; i++) unico.items[i].transactionId = `t${i + 1}`
  await adoptLoanInstallment({ installments: solo.repo }, cargo)
  assert.equal(unico.items[5].transactionId, CARGO, "con un solo crédito va a la cuota 6 que nombró el correo")
  assert.equal(unico.items[4].transactionId, null)
})

test("Dado un plan de tarjeta con una cuota registrada por la app, cuando intento mover o soltar su pago, entonces se rechaza y la cuota sigue pagada", async () => {
  const { repo } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  await executeCardInstallments({ installments: repo }, "acc1", day(2026, 9, 3))
  const pagado = plan.items[0].transactionId
  assert.ok(pagado)
  const transactions = makeTransactions({ [pagado]: { installmentItemId: plan.items[0].id } })
  for (const destino of [{ toPlanId: plan.id, toItemId: plan.items[1].id }, {}]) {
    await assert.rejects(
      () =>
        moverPago({ installments: repo, transactions }, "u1", {
          planId: plan.id,
          itemId: plan.items[0].id,
          ...destino,
        }),
      InvalidInstallmentPlanError,
      destino.toItemId ? "con destino" : "sin destino"
    )
  }
  assert.equal(plan.items[0].transactionId, pagado)
  assert.equal(plan.items[1].transactionId, null)
})

test("Dado un crédito con solo la cuota 5 pendiente y el pago en la 6, cuando muevo ese pago a la 5 del mismo plan, entonces la 6 queda pendiente, la 5 pagada con el mismo movimiento y el plan no se cierra", async () => {
  const { deps, viaje, registered } = await cargoMalEnganchado()
  viaje.items.forEach((i, n) => {
    if (n !== 4 && n !== 5) i.transactionId = `otro-${n}`
  })
  await moverPago(deps, "u1", {
    planId: viaje.id,
    itemId: viaje.items[5].id,
    toPlanId: viaje.id,
    toItemId: viaje.items[4].id,
  })
  assert.equal(viaje.items[4].transactionId, CARGO)
  assert.equal(viaje.items[5].transactionId, null)
  assert.equal(viaje.completedAt, null, "le queda la 6 pendiente: no se cierra")
  assert.equal(registered.length, 0)
})

test("Dado la cuota 2 del Notebook ($100.000) vencida, cuando al conciliar la factura la salda con lucaplan_pagar_cuota con la fecha y el monto de la factura ($99.990 el 25-09), entonces el movimiento queda con esos datos y la misma cuota no se puede saldar dos veces", async () => {
  const { repo, registered } = makeRepo()
  const deps = { installments: repo, accounts: makeAccounts(), categories }
  const plan = await createInstallmentPlan(deps, "u1", baseInput)
  const cuota2 = plan.items[1]
  await payInstallmentManually({ installments: repo }, "u1", {
    planId: plan.id,
    itemId: cuota2.id,
    date: day(2026, 9, 25),
    amount: 99_990,
  })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].itemId, cuota2.id)
  assert.equal(registered[0].amount.toMajor(), 99_990, "manda el monto de la factura, no el del plan")
  assert.equal(+registered[0].date, +day(2026, 9, 25))
  await assert.rejects(
    payInstallmentManually({ installments: repo }, "u1", {
      planId: plan.id,
      itemId: cuota2.id,
      date: day(2026, 9, 26),
      amount: 99_990,
    }),
    InstallmentItemAlreadySettledError
  )
  assert.equal(registered.length, 1)
})
