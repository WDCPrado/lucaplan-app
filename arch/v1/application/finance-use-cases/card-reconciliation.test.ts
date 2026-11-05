import test from "node:test"
import assert from "node:assert/strict"
import type {
  CardCorrectionInput,
  ReconciliationCardPlan,
  ReconciliationMovement,
  ReconciliationState,
} from "../../domain/finance/bank-reconciliation.domain.ts"
import { EmailSetupStateError } from "../../domain/finance/email-connection.domain.ts"
import { planCardCorrections } from "./card-reconciliation.ts"

function fixture() {
  const source: ReconciliationMovement = {
    id: "purchase",
    date: "2026-09-10",
    description: "Compra demo en cuotas",
    amount: 600000,
    currency: "CLP",
    direction: "debit",
    categoryId: "expense",
    bucketId: "national",
    status: "confirmed",
    isInternal: true,
    bankReceivedAt: "2026-09-10T15:00:00Z",
    installmentItemId: null,
    linked: true,
    reimbursementAmount: 0,
    updatedAt: "v1",
  }
  const plan: ReconciliationCardPlan = {
    id: "card-plan",
    sourceTransactionId: source.id,
    currency: "CLP",
    categoryId: "expense",
    totalAmount: 600000,
    installmentsCount: 6,
    updatedAt: "v1",
    items: [1, 2, 3, 4, 5, 6].map((index) => ({
      id: `item-${index}`,
      index,
      amount: 100000,
      dueDate: new Date(Date.UTC(2026, index + 7, 22))
        .toISOString()
        .slice(0, 10),
      transactionId: null,
      paidOutsideApp: false,
      updatedAt: "v1",
    })),
  }
  const state: ReconciliationState = {
    accountType: "credit_card",
    buckets: [
      {
        id: "national",
        kind: "credit_national",
        currency: "CLP",
        reconciledAt: null,
      },
    ],
    categories: [{ id: "expense", type: "expense" }],
    movements: [source],
    cardPlans: [plan],
  }
  const correction: CardCorrectionInput = {
    planId: plan.id,
    totalAmount: 678000,
    evidence: "Estado de cuenta demo: seis cuotas de 113000, total 678000",
    items: plan.items.map((item) => ({ itemId: item.id, amount: 113000 })),
  }
  return { state, source, plan, correction, inputs: [correction] }
}

function recordFirst(f: ReturnType<typeof fixture>) {
  f.plan.items[0].transactionId = "billed-first"
  const movement: ReconciliationMovement = {
    ...f.source,
    id: "billed-first",
    amount: 100000,
    date: "2026-09-22",
    description: "Compra demo en cuotas · cuota 1/6",
    isInternal: false,
    installmentItemId: f.plan.items[0].id,
    installmentOnly: true,
    cardInstallment: true,
    bankReceivedAt: null,
  }
  f.state.movements.push(movement)
  f.correction.items[0].amount = 100000
  f.correction.totalAmount = 665000
  return movement
}

test("corrige el financiamiento completo sin cambiar compra, fechas ni registrar gastos", () => {
  const f = fixture()
  // El orden que manda es la identidad de cada cuota, no su posición en el pedido.
  f.correction.items.reverse()
  const original = structuredClone(f)
  const [change] = planCardCorrections(f.state, f.inputs)
  assert.equal(change.before.totalAmount, 600000)
  assert.equal(change.after.totalAmount, 678000)
  assert.equal(change.outstandingBefore, 600000)
  assert.equal(change.outstandingAfter, 678000)
  assert.equal(change.after.sourceTransactionId, "purchase")
  assert.equal(change.evidence, f.correction.evidence)
  assert.deepEqual(
    change.after.items,
    f.plan.items.map((item) => ({ ...item, amount: 113000 }))
  )
  assert.deepEqual(f, original, "el preview no muta el estado ni el pedido")
  assert.equal(
    f.source.amount,
    600000,
    "la compra conserva su capital original"
  )
  assert.equal(
    f.state.movements.length,
    1,
    "ninguna cuota pendiente crea un cargo"
  )
})

test("conserva cuotas facturadas y fuera de la app, y solo ajusta el comprometido pendiente", () => {
  const f = fixture()
  const recorded = recordFirst(f)
  recorded.reimbursementAmount = 20000
  f.plan.items[1].paidOutsideApp = true
  f.correction.items[1].amount = 100000
  f.correction.totalAmount = 652000
  const original = structuredClone(f.state)
  const [change] = planCardCorrections(f.state, f.inputs)
  assert.equal(change.outstandingBefore, 400000)
  assert.equal(change.outstandingAfter, 452000)
  assert.deepEqual(change.after.items.slice(0, 2), f.plan.items.slice(0, 2))
  assert.deepEqual(
    change.after.items.slice(2).map((item) => item.amount),
    [113000, 113000, 113000, 113000]
  )
  assert.deepEqual(
    f.state,
    original,
    "la facturación y su reembolso permanecen iguales"
  )
})

test("conserva cuotas históricas de monto cero creadas con startIndex", () => {
  const f = fixture()
  f.plan.items[0].paidOutsideApp = true
  f.plan.items[0].amount = 0
  f.plan.totalAmount = 500000
  f.correction.items[0].amount = 0
  f.correction.totalAmount = 565000
  const [change] = planCardCorrections(f.state, f.inputs)
  assert.deepEqual(change.after.items[0], f.plan.items[0])
  assert.equal(change.outstandingBefore, 500000)
  assert.equal(change.outstandingAfter, 565000)
  assert.equal(f.state.movements.length, 1)
})

test("también permite reducir el total financiado con un cronograma completo respaldado", () => {
  const f = fixture()
  f.correction.totalAmount = 588000
  f.correction.items.forEach((item) => {
    item.amount = 98000
  })
  const [change] = planCardCorrections(f.state, f.inputs)
  assert.equal(change.after.totalAmount, 588000)
  assert.equal(change.outstandingAfter, 588000)
  assert.equal(f.source.amount, 600000)
})

test("USD conserva centavos exactos y permite una última cuota con redondeo", () => {
  const f = fixture()
  f.plan.currency = f.source.currency = "USD"
  f.plan.totalAmount = f.source.amount = 60
  f.plan.items.forEach((item) => {
    item.amount = 10
  })
  f.state.buckets[0] = {
    id: "international",
    kind: "credit_international",
    currency: "USD",
    reconciledAt: null,
  }
  f.source.bucketId = "international"
  f.correction.totalAmount = 60.01
  f.correction.items.forEach((item, index) => {
    item.amount = index === 5 ? 10.01 : 10
  })
  const [change] = planCardCorrections(f.state, f.inputs)
  assert.equal(change.outstandingAfter, 60.01)
  assert.equal(change.after.items[5].amount, 10.01)
  f.correction.items[5].amount = 10.001
  assert.throws(
    () => planCardCorrections(f.state, f.inputs),
    EmailSetupStateError
  )
})

test("exige identidad del plan, evidencia, cronograma completo, suma y precisión monetaria", async (t) => {
  const cases: [string, (f: ReturnType<typeof fixture>) => void][] = [
    [
      "otra cuenta o plan",
      (f) => {
        f.correction.planId = "foreign"
      },
    ],
    [
      "préstamo no es tarjeta",
      (f) => {
        f.state.loanPlans = f.state.cardPlans
        delete f.state.cardPlans
      },
    ],
    [
      "cuenta corriente",
      (f) => {
        f.state.accountType = "checking"
      },
    ],
    [
      "plan repetido",
      (f) => {
        f.inputs.push(structuredClone(f.correction))
      },
    ],
    [
      "cuota omitida",
      (f) => {
        f.correction.items.pop()
      },
    ],
    [
      "cuota ajena",
      (f) => {
        f.correction.items[0].itemId = "foreign"
      },
    ],
    [
      "cuota repetida",
      (f) => {
        f.correction.items[1].itemId = "item-1"
      },
    ],
    [
      "cronograma guardado incompleto",
      (f) => {
        f.plan.items.pop()
      },
    ],
    [
      "evidencia vacía",
      (f) => {
        f.correction.evidence = "  "
      },
    ],
    [
      "total no cuadra",
      (f) => {
        f.correction.totalAmount++
      },
    ],
    [
      "fracción de peso",
      (f) => {
        f.correction.items[0].amount += 0.1
      },
    ],
    [
      "total fraccionario",
      (f) => {
        f.correction.totalAmount += 0.1
      },
    ],
    [
      "monto negativo",
      (f) => {
        f.correction.items[0].amount = -1
      },
    ],
    [
      "monto cero pendiente",
      (f) => {
        f.correction.items[0].amount = 0
      },
    ],
    [
      "monto infinitesimal",
      (f) => {
        f.correction.items[0].amount = 0.000000001
      },
    ],
    [
      "total cero",
      (f) => {
        f.correction.totalAmount = 0
      },
    ],
    [
      "infinito",
      (f) => {
        f.correction.totalAmount = Infinity
      },
    ],
    [
      "no numérico",
      (f) => {
        f.correction.items[0].amount = NaN
      },
    ],
    [
      "entero inseguro",
      (f) => {
        f.correction.totalAmount = Number.MAX_SAFE_INTEGER + 1
      },
    ],
    [
      "moneda no soportada",
      (f) => {
        f.plan.currency = "EUR"
      },
    ],
  ]
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const f = fixture()
      mutate(f)
      const original = structuredClone(f.state)
      assert.throws(
        () => planCardCorrections(f.state, f.inputs),
        EmailSetupStateError
      )
      assert.deepEqual(f.state, original, "un rechazo tampoco muta el estado")
    })
  }
})

test("no reescribe historia facturada ni pagada fuera de la app", async (t) => {
  for (const outside of [false, true]) {
    await t.test(outside ? "fuera de la app" : "facturada", () => {
      const f = fixture()
      if (outside) f.plan.items[0].paidOutsideApp = true
      else recordFirst(f)
      f.correction.items[0].amount = 113000
      f.correction.totalAmount = 678000
      assert.throws(
        () => planCardCorrections(f.state, f.inputs),
        /ya registradas o fuera de la app conservan su importe/
      )
    })
  }
  const f = fixture()
  f.plan.items[0].paidOutsideApp = true
  f.plan.items[0].amount = 0
  f.correction.items[0].amount = -0.000000001
  assert.throws(
    () => planCardCorrections(f.state, f.inputs),
    EmailSetupStateError
  )
  f.correction.items[0].amount = 0.000000001
  assert.throws(
    () => planCardCorrections(f.state, f.inputs),
    EmailSetupStateError
  )
})

test("rechaza una compra inexistente, anulada, sin neutralizar o incompatible", async (t) => {
  const cases: [string, (f: ReturnType<typeof fixture>) => void][] = [
    [
      "origen ajeno o inexistente",
      (f) => {
        f.plan.sourceTransactionId = "foreign"
      },
    ],
    [
      "origen anulado",
      (f) => {
        f.source.status = "cancelled"
      },
    ],
    [
      "origen abono",
      (f) => {
        f.source.direction = "credit"
      },
    ],
    [
      "origen de otra moneda",
      (f) => {
        f.source.currency = "USD"
      },
    ],
    [
      "origen sin neutralizar",
      (f) => {
        f.source.isInternal = false
      },
    ],
    [
      "origen sin vínculo",
      (f) => {
        f.source.linked = false
      },
    ],
    [
      "origen también es cuota",
      (f) => {
        f.source.installmentItemId = "other-item"
      },
    ],
    [
      "origen sin importe",
      (f) => {
        f.source.amount = 0
      },
    ],
  ]
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const f = fixture()
      mutate(f)
      assert.throws(
        () => planCardCorrections(f.state, f.inputs),
        EmailSetupStateError
      )
    })
  }
})

test("rechaza cuotas registradas que no coinciden con su movimiento", async (t) => {
  const cases: [string, Partial<ReconciliationMovement>][] = [
    ["vínculo a otra cuota", { installmentItemId: "other-item" }],
    ["otros vínculos", { installmentOnly: false }],
    ["movimiento de préstamo", { cardInstallment: false }],
    ["transferencia interna", { isInternal: true }],
    ["anulado", { status: "cancelled" }],
    ["abono", { direction: "credit" }],
    ["otra moneda", { currency: "USD" }],
    ["otra categoría", { categoryId: "other-category" }],
    ["importe diferente", { amount: 100001 }],
  ]
  for (const [name, patch] of cases) {
    await t.test(name, () => {
      const f = fixture()
      Object.assign(recordFirst(f), patch)
      assert.throws(
        () => planCardCorrections(f.state, f.inputs),
        /no coincide con su movimiento de tarjeta/
      )
    })
  }
  const f = fixture()
  recordFirst(f)
  f.state.movements.pop()
  assert.throws(
    () => planCardCorrections(f.state, f.inputs),
    /concilia su vínculo primero/
  )
  recordFirst(f)
  f.plan.items[0].paidOutsideApp = true
  assert.throws(
    () => planCardCorrections(f.state, f.inputs),
    /concilia su vínculo primero/
  )
})

test("las conciliaciones que no corrigen tarjetas conservan compatibilidad", () => {
  const f = fixture()
  f.state.accountType = "checking"
  delete f.state.cardPlans
  assert.deepEqual(planCardCorrections(f.state, []), [])
})
