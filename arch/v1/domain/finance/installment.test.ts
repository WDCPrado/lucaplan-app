// Dominio de cuotas: cronograma, reparto, selección de la cuota a registrar, selección del plan
// para un pago de crédito (con la tolerancia SOLO como desempate), avance y saldo.
// Corre con: node --test arch/v1/domain/finance/installment.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "./money.ts"
import { periodRange } from "../../../shared/billing-cycle.ts"
import {
  accountAllowsKind,
  committedForMonth,
  isComplete,
  itemForPayment,
  itemStatus,
  nextDueItem,
  outstanding,
  pickLoanPlanFor,
  progress,
  requiresExactSplit,
  schedule,
  splitAmount,
  splitMatchesTotal,
  type InstallmentItem,
  type InstallmentKind,
  type InstallmentPlan,
} from "./installment.domain.ts"

const clp = (n: number) => Money.fromMinor(n, "CLP")
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

function makeItem(
  index: number,
  dueDate: Date,
  amount: Money,
  over: Partial<InstallmentItem> = {}
): InstallmentItem {
  return {
    id: `i${index}`,
    index,
    dueDate,
    amount,
    transactionId: null,
    paidOutsideApp: false,
    ...over,
  }
}

function makePlan(over: Partial<InstallmentPlan> = {}): InstallmentPlan {
  const kind: InstallmentKind = over.kind ?? "loan"
  const count = over.installmentsCount ?? 3
  const total = over.totalAmount ?? clp(300_000)
  const start = over.startDate ?? day(2026, 8, 5)
  const dates = schedule(start, 5, count)
  const amounts = splitAmount(total, count)
  return {
    id: "p1",
    userId: "u1",
    kind,
    accountId: "acc1",
    categoryId: "cat1",
    sourceTransactionId: null,
    description: "Deuda",
    totalAmount: total,
    currency: "CLP",
    installmentsCount: count,
    startDate: start,
    dayOfMonth: 5,
    tolerancePct: 10,
    completedAt: null,
    items: dates.map((d, i) => makeItem(i + 1, d, amounts[i])),
    ...over,
  }
}

// --- Cronograma ---

test("el cronograma reparte una cuota por mes desde el día de pago", () => {
  const dates = schedule(day(2026, 8, 5), 5, 3)
  assert.deepEqual(
    dates.map((d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()]),
    [
      [2026, 8, 5],
      [2026, 9, 5],
      [2026, 10, 5],
    ]
  )
})

test("un día 31 cae al último día en los meses cortos", () => {
  const dates = schedule(day(2026, 1, 31), 31, 3)
  assert.deepEqual(
    dates.map((d) => d.getDate()),
    [31, 28, 31] // enero, febrero (2026 no bisiesto), marzo
  )
})

test("el cronograma cruza el cambio de año", () => {
  const dates = schedule(day(2026, 11, 10), 10, 3)
  assert.deepEqual(
    dates.map((d) => [d.getFullYear(), d.getMonth() + 1]),
    [
      [2026, 11],
      [2026, 12],
      [2027, 1],
    ]
  )
})

// --- Reparto ---

test("el reparto por defecto divide el total en partes iguales", () => {
  const parts = splitAmount(clp(300_000), 3)
  assert.deepEqual(
    parts.map((p) => p.toMajor()),
    [100_000, 100_000, 100_000]
  )
})

test("el resto de la división queda en la última cuota y la suma es exacta", () => {
  const total = clp(100_000)
  const parts = splitAmount(total, 3)
  assert.deepEqual(
    parts.map((p) => p.toMajor()),
    [33_333, 33_333, 33_334]
  )
  assert.ok(splitMatchesTotal(total, parts))
})

test("solo card exige que los montos sumen el total", () => {
  assert.equal(requiresExactSplit("card"), true)
  assert.equal(requiresExactSplit("loan"), false)
})

test("un monto editado que rompe el total se detecta", () => {
  const total = clp(300_000)
  assert.equal(
    splitMatchesTotal(total, [clp(120_000), clp(100_000), clp(100_000)]),
    false
  )
  assert.equal(
    splitMatchesTotal(total, [clp(120_000), clp(90_000), clp(90_000)]),
    true
  )
})

// --- Cuenta según el tipo ---

test("card exige tarjeta de crédito porque su disparador es el pago de esa tarjeta", () => {
  assert.equal(accountAllowsKind("card", "credit_card"), true)
  assert.equal(accountAllowsKind("card", "checking"), false)
})

test("loan acepta la cuenta de cargo, sea cual sea", () => {
  assert.equal(accountAllowsKind("loan", "checking"), true)
  assert.equal(accountAllowsKind("loan", "credit_card"), true)
})

// --- Selección de la cuota ---

test("se registra la cuota pendiente más antigua ya vencida", () => {
  const plan = makePlan()
  const item = nextDueItem(plan, day(2026, 9, 20))
  assert.equal(item?.index, 1)
})

test("con la primera cuota ya registrada, sigue la segunda", () => {
  const plan = makePlan()
  plan.items[0].transactionId = "t1"
  assert.equal(nextDueItem(plan, day(2026, 9, 20))?.index, 2)
})

test("una cuota que aún no vence no se registra", () => {
  const plan = makePlan()
  assert.equal(nextDueItem(plan, day(2026, 7, 1)), null)
})

test("la cuota que vence justo el día del pago sí se registra", () => {
  const plan = makePlan()
  assert.equal(nextDueItem(plan, day(2026, 8, 5))?.index, 1)
})

test("dos cuotas atrasadas se saldan de a una", () => {
  const plan = makePlan()
  const first = nextDueItem(plan, day(2026, 10, 1))
  assert.equal(first?.index, 1)
  first!.transactionId = "t1"
  assert.equal(nextDueItem(plan, day(2026, 10, 1))?.index, 2)
})

test("una cuota pagada fuera de la app no vuelve a registrarse", () => {
  const plan = makePlan()
  plan.items[0].paidOutsideApp = true
  assert.equal(nextDueItem(plan, day(2026, 9, 20))?.index, 2)
})

// --- Selección del plan para un pago de crédito ---

const payment = (over: Partial<Parameters<typeof pickLoanPlanFor>[0]> = {}) => ({
  accountId: "acc1",
  amount: clp(100_000),
  date: day(2026, 8, 5),
  installmentNumber: null,
  ...over,
})

test("con un único plan de la cuenta, ese es", () => {
  const plan = makePlan()
  assert.equal(pickLoanPlanFor(payment(), [plan])?.id, "p1")
})

test("un pago de otra cuenta no elige ningún plan", () => {
  const plan = makePlan()
  assert.equal(pickLoanPlanFor(payment({ accountId: "otra" }), [plan]), null)
})

test("un plan completado no reclama pagos", () => {
  const plan = makePlan({ completedAt: day(2026, 7, 1) })
  assert.equal(pickLoanPlanFor(payment(), [plan]), null)
})

test("un plan card no se engancha a un pago de cuota de crédito", () => {
  const plan = makePlan({ kind: "card" })
  assert.equal(pickLoanPlanFor(payment(), [plan]), null)
})

test("la última cuota fuera de tolerancia se registra igual si el plan es único", () => {
  // El modo de fallo que hundía al crédito de consumo modelado como plantilla recurrente:
  // el monto real se desvía muchísimo del estimado y el plan no se cerraría nunca.
  const plan = makePlan()
  plan.items[0].transactionId = "t1"
  plan.items[1].transactionId = "t2"
  const elegido = pickLoanPlanFor(
    payment({ amount: clp(43_120), date: day(2026, 10, 5) }),
    [plan]
  )
  assert.equal(elegido?.id, "p1")
})

test("dos planes de la misma cuenta se desempatan por el N° de cuota del correo", () => {
  const a = makePlan({ id: "a" })
  const b = makePlan({ id: "b" })
  b.items[0].transactionId = "t1" // b va una cuota más adelante
  const elegido = pickLoanPlanFor(
    payment({ date: day(2026, 9, 5), installmentNumber: 2 }),
    [a, b]
  )
  assert.equal(elegido?.id, "b")
})

test("sin N° de cuota, dos planes se desempatan por el monto dentro de tolerancia", () => {
  const a = makePlan({ id: "a", totalAmount: clp(300_000) }) // cuotas de 100.000
  const b = makePlan({ id: "b", totalAmount: clp(900_000) }) // cuotas de 300.000
  const elegido = pickLoanPlanFor(payment({ amount: clp(305_000) }), [a, b])
  assert.equal(elegido?.id, "b")
})

test("dos planes indistinguibles dejan el gasto suelto", () => {
  const a = makePlan({ id: "a" })
  const b = makePlan({ id: "b" })
  assert.equal(pickLoanPlanFor(payment(), [a, b]), null)
})

// WDC-120: con varios créditos en la cuenta manda el monto; el N° de cuota solo desempata.

// Plan `loan` con cuotas de `cuota` y las primeras `pagadas` ya saldadas.
function loanPlan(id: string, cuota: number, pagadas: number, start: Date) {
  const plan = makePlan({
    id,
    totalAmount: clp(cuota * 10),
    installmentsCount: 10,
    startDate: start,
  })
  for (let i = 0; i < pagadas; i++) plan.items[i].transactionId = `${id}-t${i + 1}`
  return plan
}

test("Dado el Crédito Consumo ($254.156, va en la cuota 5) y el Viaje Jo ($53.450, va en la 6), cuando llega un cargo de $265.708 con correo «cuota 6», entonces se registra en el Crédito Consumo", () => {
  const credito = loanPlan("credito", 254_156, 4, day(2026, 3, 5)) // cuota 5 vence 5/7
  const viaje = loanPlan("viaje", 53_450, 5, day(2026, 2, 5)) // cuota 6 vence 5/7
  const cargo = (installmentNumber: number | null) =>
    payment({ amount: clp(265_708), date: day(2026, 7, 5), installmentNumber })
  assert.equal(pickLoanPlanFor(cargo(6), [credito, viaje])?.id, "credito")
  assert.equal(pickLoanPlanFor(cargo(6), [viaje, credito])?.id, "credito", "el orden no importa")
  assert.equal(pickLoanPlanFor(cargo(5), [credito, viaje])?.id, "credito")
  assert.equal(pickLoanPlanFor(cargo(null), [credito, viaje])?.id, "credito")
})

test("Dado dos créditos con cuotas de $100.000 y $110.000, cuando llega un cargo que calza con los dos, entonces gana el más cercano y el N° de cuota solo desempata cuando están a igual distancia", () => {
  const a = loanPlan("a", 100_000, 1, day(2026, 8, 5)) // pendiente: cuota 2
  const b = loanPlan("b", 110_000, 0, day(2026, 8, 5)) // pendiente: cuota 1
  const cargo = (monto: number, installmentNumber: number | null) =>
    payment({ amount: clp(monto), date: day(2026, 9, 5), installmentNumber })
  // $104.000 está más cerca de A: gana A, diga lo que diga el correo.
  assert.equal(pickLoanPlanFor(cargo(104_000, null), [a, b])?.id, "a")
  assert.equal(pickLoanPlanFor(cargo(104_000, 1), [a, b])?.id, "a", "el N° de cuota no le gana al monto")
  // $105.000 está a igual distancia: decide el N° de cuota; sin número, gasto suelto.
  assert.equal(pickLoanPlanFor(cargo(105_000, 2), [a, b])?.id, "a")
  assert.equal(pickLoanPlanFor(cargo(105_000, 1), [a, b])?.id, "b")
  assert.equal(pickLoanPlanFor(cargo(105_000, null), [a, b]), null)
  // Un peso más ya está más cerca de B.
  assert.equal(pickLoanPlanFor(cargo(105_001, 2), [a, b])?.id, "b")
})

test("Dado dos créditos de $100.000 y $400.000, cuando llega un cargo que no calza con ninguno, entonces se elige el más cercano en monto y, si están a igual distancia, queda como gasto suelto", () => {
  const a = loanPlan("a", 100_000, 1, day(2026, 8, 5)) // pendiente: cuota 2
  const b = loanPlan("b", 400_000, 0, day(2026, 8, 5)) // pendiente: cuota 1
  const cargo = (monto: number, installmentNumber: number | null) =>
    payment({ amount: clp(monto), date: day(2026, 9, 5), installmentNumber })
  assert.equal(pickLoanPlanFor(cargo(150_000, null), [a, b])?.id, "a")
  assert.equal(
    pickLoanPlanFor(cargo(150_000, 1), [a, b])?.id,
    "a",
    "el N° de cuota no le gana al monto"
  )
  assert.equal(pickLoanPlanFor(cargo(250_000, null), [a, b]), null)
})

test("un pago en otra moneda no elige plan", () => {
  const plan = makePlan()
  const elegido = pickLoanPlanFor(
    payment({ amount: Money.fromMinor(10_000, "USD") }),
    [plan]
  )
  assert.equal(elegido, null)
})

// --- Ítem que salda el pago ---

test("el N° de cuota del correo elige el ítem aunque queden anteriores sin saldar", () => {
  const plan = makePlan()
  const item = itemForPayment(
    plan,
    payment({ date: day(2026, 10, 5), installmentNumber: 3 })
  )
  assert.equal(item?.index, 3)
  assert.equal(plan.items[0].transactionId, null) // la 1 sigue pendiente
})

test("sin N° de cuota se salda la más antigua vencida", () => {
  const plan = makePlan()
  assert.equal(itemForPayment(plan, payment({ date: day(2026, 10, 5) }))?.index, 1)
})

test("si el banco nombra una cuota ya saldada, no se mete en otra", () => {
  // Meterla en la 1 reportaría como cuota 1 lo que el banco llamó cuota 3.
  const plan = makePlan()
  plan.items[2].transactionId = "t3"
  const item = itemForPayment(
    plan,
    payment({ date: day(2026, 10, 5), installmentNumber: 3 })
  )
  assert.equal(item, null)
})

// WDC-178: cuándo el correo reemplaza una cuota generada a mano («Generar cuota»).

// Crédito de 4 cuotas de $100.000 (vencen 5/8, 5/9, 5/10, 5/11): 1 y 2 del banco, 3 generada a
// mano, 4 pendiente.
function withGenerated3(over: Partial<InstallmentPlan> = {}) {
  const plan = makePlan({ installmentsCount: 4, totalAmount: clp(400_000), ...over })
  plan.items[0].transactionId = "banco-1"
  plan.items[1].transactionId = "banco-2"
  plan.items[2].transactionId = "gen-3"
  plan.items[2].manualTransaction = true
  return plan
}

test("Dado la cuota 3 generada a mano y la 4 pendiente, cuando llega sin N° un pago adelantado de la 4 (2 días antes de su vencimiento), entonces no reemplaza la 3", () => {
  const plan = withGenerated3()
  assert.equal(itemForPayment(plan, payment({ date: day(2026, 11, 3) })), null)
})

test("Dado la cuota 3 generada a mano, cuando llega sin N° un pago a 3 días de su vencimiento, entonces la reemplaza", () => {
  const plan = withGenerated3()
  assert.equal(itemForPayment(plan, payment({ date: day(2026, 10, 8) }))?.index, 3)
})

test("Dado la cuota 3 generada a mano, cuando llega sin N° un pago a más de 10 días de cualquier vencimiento, entonces no reemplaza nada", () => {
  const plan = withGenerated3()
  assert.equal(itemForPayment(plan, payment({ date: day(2026, 10, 20) })), null)
})

test("Dado la cuota 2 generada a mano y la 3 pendiente, cuando llega sin N° un pago cerca del vencimiento de la 3, entonces salda la 3 como siempre", () => {
  const plan = makePlan()
  plan.items[0].transactionId = "banco-1"
  plan.items[1].transactionId = "gen-2"
  plan.items[1].manualTransaction = true
  assert.equal(itemForPayment(plan, payment({ date: day(2026, 10, 6) }))?.index, 3)
})

// Crédito cerrado: todas saldadas, la última (vence 5/11) generada a mano.
function closedWithGeneratedLast() {
  const plan = withGenerated3({ id: "cerrado", completedAt: day(2026, 11, 5) })
  plan.items[2].manualTransaction = false
  plan.items[2].transactionId = "banco-3"
  plan.items[3].transactionId = "gen-4"
  plan.items[3].manualTransaction = true
  return plan
}

test("Dado un crédito cerrado con su última cuota generada a mano, cuando llega sin N° el primer correo de otro crédito con otro monto, entonces no lo toma", () => {
  const plan = closedWithGeneratedLast()
  assert.equal(
    pickLoanPlanFor(payment({ amount: clp(254_000), date: day(2026, 11, 6) }), [plan]),
    null
  )
})

test("Dado un crédito cerrado con su última cuota generada a mano, cuando llega sin N° un pago de ese monto cerca del vencimiento, entonces lo toma", () => {
  const plan = closedWithGeneratedLast()
  assert.equal(
    pickLoanPlanFor(payment({ amount: clp(103_000), date: day(2026, 11, 6) }), [plan])?.id,
    "cerrado"
  )
})

test("Dado un crédito cerrado con su última cuota generada a mano, cuando llega un pago un año después, con o sin N°, entonces no lo toma", () => {
  const plan = closedWithGeneratedLast()
  const late = day(2027, 11, 5)
  assert.equal(pickLoanPlanFor(payment({ date: late }), [plan]), null)
  assert.equal(pickLoanPlanFor(payment({ date: late, installmentNumber: 4 }), [plan]), null)
})

test("Dado un crédito cerrado con su última cuota generada a mano, cuando llega el correo «cuota 4» dentro del período, entonces lo toma aunque el monto difiera", () => {
  const plan = closedWithGeneratedLast()
  assert.equal(
    pickLoanPlanFor(
      payment({ amount: clp(140_000), date: day(2026, 11, 20), installmentNumber: 4 }),
      [plan]
    )?.id,
    "cerrado"
  )
})

// --- Estado, avance y saldo ---

test("el estado de una cuota distingue registrada, fuera de la app, vencida y por venir", () => {
  const plan = makePlan()
  const hoy = day(2026, 9, 20)
  assert.equal(
    itemStatus(makeItem(1, day(2026, 8, 5), clp(1), { transactionId: "t" }), hoy),
    "paid"
  )
  assert.equal(
    itemStatus(makeItem(1, day(2026, 8, 5), clp(1), { paidOutsideApp: true }), hoy),
    "outside_app"
  )
  assert.equal(itemStatus(plan.items[0], hoy), "overdue")
  assert.equal(itemStatus(plan.items[2], hoy), "upcoming")
})

test("el avance cuenta las cuotas saldadas por cualquier vía", () => {
  const plan = makePlan()
  plan.items[0].transactionId = "t1"
  plan.items[1].paidOutsideApp = true
  assert.deepEqual(progress(plan), { settled: 2, total: 3 })
})

test("el saldo pendiente se calcula sobre lo registrado, no sobre el cronograma", () => {
  const plan = makePlan({ totalAmount: clp(4_800_000), installmentsCount: 48 })
  const saldo = outstanding(plan, [clp(620_000), clp(620_000)])
  assert.equal(saldo.toMajor(), 3_560_000)
})

const mes = (year: number, month: number) =>
  periodRange(year, month, "calendar", {})

test("el comprometido del mes es la cuota que vence ese mes y aún no se paga", () => {
  const plan = makePlan() // cuotas en ago, sep, oct de 2026
  assert.equal(committedForMonth(plan, mes(2026, 8)).toMajor(), 100_000)
  assert.equal(committedForMonth(plan, mes(2026, 9)).toMajor(), 100_000)
})

test("una cuota ya pagada no aporta al comprometido de su mes", () => {
  const plan = makePlan()
  plan.items[0].transactionId = "t1"
  assert.equal(committedForMonth(plan, mes(2026, 8)).toMajor(), 0)
})

test("un mes sin cuotas no compromete nada", () => {
  const plan = makePlan()
  assert.equal(committedForMonth(plan, mes(2026, 7)).toMajor(), 0)
  assert.equal(committedForMonth(plan, mes(2026, 11)).toMajor(), 0)
})

test("el plan se completa cuando todas sus cuotas están saldadas", () => {
  const plan = makePlan()
  plan.items.forEach((i) => (i.transactionId = "t"))
  assert.equal(isComplete(plan), true)
})

test("un plan con una cuota pendiente no está completo", () => {
  const plan = makePlan()
  plan.items[0].transactionId = "t"
  assert.equal(isComplete(plan), false)
})
