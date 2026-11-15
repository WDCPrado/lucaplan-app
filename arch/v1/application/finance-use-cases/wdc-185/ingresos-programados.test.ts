// WDC-185 · Ingresos programados: la base del plan («siempre está mi sueldo») más los abonos sueltos.
// Un programado es una expectativa: cuenta su esperado hasta que llega su abono vinculado.
// Corre con: node --test arch/v1/application/finance-use-cases/wdc-185/ingresos-programados.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import type { Transaction } from "../../../domain/finance/finance.domain.ts"
import { NotOwnerError } from "../../../domain/finance/finance.domain.ts"
import {
  IncomeSourceNotFoundError,
  InvalidIncomeSourceError,
  occurrencesIn,
  type IncomeSource,
  type IncomeSourceRepository,
} from "../../../domain/finance/income-source.domain.ts"
import type {
  ReconciliationMovement,
  ReconciliationState,
} from "../../../domain/finance/bank-reconciliation.domain.ts"
import type { StatementDocument, BankReconciliationInput } from "../../../../../lib/schemas/bank-reconciliation.ts"
import { incomeOfPeriod, planIncome } from "../budget-formulas.ts"
import {
  createIncomeSource,
  deleteIncomeSource,
  linkCreditToIncomeSource,
  listIncomeSources,
  setIncomeSourceMonthAmount,
  type IncomeSourceDeps,
} from "../income-source-use-cases.ts"
import { proposeReconciliation } from "../propose-reconciliation.ts"
import { planBankReconciliation } from "../bank-reconciliation.ts"
import { getBudgetView } from "../finance-read.ts"

const source = (id: string, over: Partial<IncomeSource> = {}): IncomeSource => {
  const currency = over.currency ?? "CLP"
  return {
    id,
    userId: "u1",
    name: id,
    categoryId: "sueldo",
    currency,
    amount: Money.of(1_500_000, currency),
    dayOfMonth: 5,
    startsOn: "2026-01-01",
    endsOn: null,
    amounts: [],
    ...over,
  }
}

const credit = (id: string, date: string, amount: number, over: Partial<Transaction> = {}): Transaction => ({
  id,
  userId: "u1",
  accountId: "corriente",
  categoryId: "sueldo",
  date: new Date(`${date}T00:00:00Z`),
  description: id,
  amount: Money.of(amount, (over.amount?.currency ?? "CLP") as CurrencyCode),
  direction: "credit",
  status: "confirmed",
  isInternal: false,
  externalId: null,
  origin: "statement",
  creditKind: "income",
  ...over,
})

const major = (m: Money) => m.toMajor()
const nov = { start: "2026-11-01", end: "2026-11-30" }

test("ingreso del plan: el programado aporta su esperado mientras no llega; lo recibido lo reemplaza (mayor o menor); los sueltos suman aparte", () => {
  const sueldo = source("sueldo")
  // Pendiente: aún no llega nada → cuenta el esperado.
  assert.equal(major(incomeOfPeriod([], nov, "CLP", [sueldo])), 1_500_000)
  // Llegó menos: cuenta lo recibido, no el esperado.
  const menos = [credit("abono", "2026-11-05", 1_400_000, { incomeSourceId: "sueldo" })]
  assert.equal(major(incomeOfPeriod(menos, nov, "CLP", [sueldo])), 1_400_000)
  // Llegó en dos partes: la suma reemplaza al esperado.
  const partes = [
    credit("a", "2026-11-05", 1_000_000, { incomeSourceId: "sueldo" }),
    credit("b", "2026-11-06", 600_000, { incomeSourceId: "sueldo" }),
  ]
  const p = planIncome(partes, nov, "CLP", [sueldo])
  assert.equal(major(p.total), 1_600_000)
  assert.deepEqual(p.sources[0].credits.map((t) => t.id), ["a", "b"])
  // Un suelto (sin programado) suma encima del esperado.
  const suelto = [credit("venta", "2026-11-12", 80_000)]
  assert.equal(major(incomeOfPeriod(suelto, nov, "CLP", [sueldo])), 1_580_000)
  // Sin programados es la regla de WDC-183: solo abonos.
  assert.equal(major(incomeOfPeriod(suelto, nov, "CLP")), 80_000)
})

test("un abono vinculado cuya fecha cae en un período donde su programado no tiene ocurrencia cuenta como suelto, no se pierde", () => {
  // Termina en octubre: en noviembre no hay ocurrencia, pero el abono atrasado llega el 2.
  const terminado = source("bono", { endsOn: "2026-10-31" })
  const tarde = [credit("bono-oct", "2026-11-02", 300_000, { incomeSourceId: "bono" })]
  const p = planIncome(tarde, nov, "CLP", [terminado])
  assert.equal(p.sources.length, 0)
  assert.deepEqual(p.loose.map((t) => t.id), ["bono-oct"])
  assert.equal(major(p.total), 300_000)
  // Un vínculo a un programado que ya no existe también es suelto.
  assert.equal(major(incomeOfPeriod([credit("x", "2026-11-03", 10_000, { incomeSourceId: "borrado" })], nov, "CLP", [])), 10_000)
})

test("CLP y USD por separado: un programado en USD no suma al CLP y sus abonos tampoco", () => {
  const usd = source("freelance", { currency: "USD", amount: Money.of(500, "USD") })
  const clp = source("sueldo")
  const txs = [credit("usd-abono", "2026-11-07", 480, { amount: Money.of(480, "USD"), incomeSourceId: "freelance" })]
  assert.equal(major(incomeOfPeriod(txs, nov, "CLP", [usd, clp])), 1_500_000)
  assert.equal(major(incomeOfPeriod(txs, nov, "USD", [usd, clp])), 480)
  assert.equal(major(incomeOfPeriod([], nov, "USD", [usd, clp])), 500)
})

test("ciclo de tarjeta que cruza meses: el día esperado se busca en cada mes calendario del ciclo (cero, una o dos ocurrencias)", () => {
  const ciclo = { start: "2026-10-26", end: "2026-11-25" }
  assert.deepEqual(occurrencesIn(source("s", { dayOfMonth: 30 }), ciclo), ["2026-10-30"])
  assert.deepEqual(occurrencesIn(source("s", { dayOfMonth: 5 }), ciclo), ["2026-11-05"])
  // Del 1 al 31 de un ciclo largo: dos ocurrencias del día 28.
  const largo = { start: "2026-10-28", end: "2026-11-28" }
  assert.deepEqual(occurrencesIn(source("s", { dayOfMonth: 28 }), largo), ["2026-10-28", "2026-11-28"])
  assert.equal(major(incomeOfPeriod([], largo, "CLP", [source("s", { dayOfMonth: 28 })])), 3_000_000)
  // Mes corto: el 31 cae el último día de febrero.
  assert.deepEqual(occurrencesIn(source("s", { dayOfMonth: 31 }), { start: "2027-02-01", end: "2027-02-28" }), ["2027-02-28"])
  // Un ciclo que no contiene el día: sin ocurrencias, no aporta.
  assert.deepEqual(occurrencesIn(source("s", { dayOfMonth: 26 }), { start: "2026-10-27", end: "2026-11-25" }), [])
})

test("startsOn y endsOn: antes de empezar y después de terminar no hay esperado; los bordes cuentan", () => {
  assert.equal(major(incomeOfPeriod([], nov, "CLP", [source("s", { startsOn: "2026-12-01" })])), 0)
  assert.equal(major(incomeOfPeriod([], nov, "CLP", [source("s", { startsOn: "2026-11-05" })])), 1_500_000)
  assert.equal(major(incomeOfPeriod([], nov, "CLP", [source("s", { endsOn: "2026-11-05" })])), 1_500_000)
  assert.equal(major(incomeOfPeriod([], nov, "CLP", [source("s", { endsOn: "2026-11-04" })])), 0)
})

test("monto por mes: el esperado de una ocurrencia es el de su mes si se fijó, si no el base (Cuota Viaje Jo)", () => {
  const cuota = source("viaje", {
    amount: Money.of(165_114, "CLP"),
    endsOn: "2027-02-28",
    amounts: [{ month: "2027-01", amount: Money.of(53_448, "CLP") }],
  })
  const mes = (y: number, m: number) => ({
    start: `${y}-${String(m).padStart(2, "0")}-01`,
    end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
  })
  assert.equal(major(incomeOfPeriod([], mes(2026, 12), "CLP", [cuota])), 165_114)
  assert.equal(major(incomeOfPeriod([], mes(2027, 1), "CLP", [cuota])), 53_448)
  assert.equal(major(incomeOfPeriod([], mes(2027, 2), "CLP", [cuota])), 165_114)
  assert.equal(major(incomeOfPeriod([], mes(2027, 3), "CLP", [cuota])), 0)
})

// --- Casos de uso con repos en memoria ---

function fixture(txs: Transaction[] = [], sources: IncomeSource[] = []) {
  const categories = [
    { id: "sueldo", type: "income" },
    { id: "gasto", type: "expense" },
  ].map((c) => ({ ...c, userId: "u1", name: c.id, icon: null, color: null, description: null, paceEnabled: true }))
  let seq = 0
  const incomeSources: IncomeSourceRepository = {
    async listByUser(u) {
      return sources.filter((s) => s.userId === u)
    },
    async findById(id) {
      return sources.find((s) => s.id === id) ?? null
    },
    async create(input) {
      const s = { ...input, id: `nuevo-${++seq}`, amounts: [] }
      sources.push(s)
      return s
    },
    async update(id, _u, patch) {
      const i = sources.findIndex((s) => s.id === id)
      sources[i] = { ...sources[i], ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) }
      return sources[i]
    },
    async countLinked(id) {
      return txs.filter((t) => t.incomeSourceId === id).length
    },
    async delete(id) {
      sources.splice(sources.findIndex((s) => s.id === id), 1)
    },
    async setMonthAmount(id, _u, month, amount) {
      const s = sources.find((x) => x.id === id)!
      s.amounts = s.amounts.filter((a) => a.month !== month)
      if (amount) s.amounts.push({ month, amount })
    },
    async linkCredit(transactionId, _u, incomeSourceId) {
      const i = txs.findIndex((t) => t.id === transactionId)
      txs[i] = { ...txs[i], incomeSourceId }
    },
  }
  const deps = {
    accounts: { async listByUser() { return [] } },
    categories: { async listByUser() { return categories }, async listLimitsByUser() { return [] } },
    transactions: {
      async listByUserPeriod(u: string, range: { start: string; end: string }) {
        return txs.filter((t) => {
          const d = t.date.toISOString().slice(0, 10)
          return t.userId === u && d >= range.start && d <= range.end
        })
      },
      async findById(id: string) {
        return txs.find((t) => t.id === id) ?? null
      },
    },
    monthlyBudgets: { async listByUser() { return [] }, async setFollowingIncome() { return false } },
    exchangeRates: { async clpPerUsdAt() { return 950 } },
    budgetPeriod: { async get() { return { mode: "calendar", overrides: {} } } },
    incomeSources,
  } as unknown as IncomeSourceDeps
  return { deps, txs, sources }
}

const TODAY = { today: "2026-11-15" }

test("eliminar un programado sin abonos vinculados lo borra; con vínculos termina su vigencia hoy y conserva los abonos", async () => {
  const f = fixture(
    [credit("abono", "2026-10-05", 1_500_000, { incomeSourceId: "con" })],
    [source("sin"), source("con")]
  )
  assert.deepEqual(await deleteIncomeSource(f.deps, "u1", "sin", TODAY), { deleted: true })
  assert.equal(f.sources.some((s) => s.id === "sin"), false)
  assert.deepEqual(await deleteIncomeSource(f.deps, "u1", "con", TODAY), { ended: true })
  assert.equal(f.sources.find((s) => s.id === "con")?.endsOn, "2026-11-15")
  assert.equal(f.txs[0].incomeSourceId, "con")
  // Ajeno: no existe para este usuario.
  await assert.rejects(deleteIncomeSource(f.deps, "otro", "con", TODAY), IncomeSourceNotFoundError)
})

test("vincular: el abono de ingreso se ata a un programado de su moneda; otra moneda, un cargo, un reembolso o algo ajeno se rechazan sin escribir", async () => {
  const f = fixture(
    [
      credit("abono", "2026-11-05", 1_450_000),
      credit("usd", "2026-11-05", 400, { amount: Money.of(400, "USD") }),
      credit("reembolso", "2026-11-06", 20_000, { creditKind: "reimbursement" }),
      credit("cargo", "2026-11-07", 9_000, { direction: "debit", creditKind: null }),
      credit("ajeno", "2026-11-08", 5_000, { userId: "otro" }),
    ],
    [source("sueldo"), source("de-otro", { userId: "otro" })]
  )
  // Antes de vincular: esperado 1.500.000 + abono suelto 1.450.000.
  let [dto] = await listIncomeSources(f.deps, "u1", {}, TODAY)
  assert.equal(dto.period.status, "pending")
  assert.equal(dto.period.pending, 1_500_000)
  // El presupuesto usa la misma definición: esperado + suelto.
  assert.equal((await getBudgetView(f.deps, "u1", 2026, 11)).income, 2_950_000)

  assert.deepEqual(await linkCreditToIncomeSource(f.deps, "u1", "abono", "sueldo", TODAY), { id: "abono", incomeSourceId: "sueldo" })
  ;[dto] = await listIncomeSources(f.deps, "u1", {}, TODAY)
  assert.equal(dto.period.status, "received")
  assert.equal(dto.period.received, 1_450_000)
  assert.equal(dto.period.pending, 0)
  assert.deepEqual(dto.period.credits.map((c) => c.id), ["abono"])
  // Vinculado, lo recibido reemplaza al esperado: ya no se cuenta dos veces.
  const view = await getBudgetView(f.deps, "u1", 2026, 11)
  assert.equal(view.income, 1_450_000)
  assert.equal(view.categories.find((c) => c.id === "sueldo")?.limit, 1_450_000)

  await assert.rejects(linkCreditToIncomeSource(f.deps, "u1", "usd", "sueldo", TODAY), InvalidIncomeSourceError)
  await assert.rejects(linkCreditToIncomeSource(f.deps, "u1", "reembolso", "sueldo", TODAY), InvalidIncomeSourceError)
  await assert.rejects(linkCreditToIncomeSource(f.deps, "u1", "cargo", "sueldo", TODAY), InvalidIncomeSourceError)
  await assert.rejects(linkCreditToIncomeSource(f.deps, "u1", "ajeno", "sueldo", TODAY), NotOwnerError)
  await assert.rejects(linkCreditToIncomeSource(f.deps, "u1", "abono", "de-otro", TODAY), IncomeSourceNotFoundError)
  assert.equal(f.txs.find((t) => t.id === "usd")?.incomeSourceId, undefined)

  // Desvincular lo devuelve a suelto.
  await linkCreditToIncomeSource(f.deps, "u1", "abono", null, TODAY)
  assert.equal(f.txs.find((t) => t.id === "abono")?.incomeSourceId, null)
})

test("crear valida la categoría de ingreso y el monto de su moneda; el monto de un mes cambia el esperado de ese período", async () => {
  const f = fixture()
  const base = { name: "Cuota", categoryId: "sueldo", currency: "CLP" as const, amount: 165_114, dayOfMonth: 10, startsOn: "2026-11-01", endsOn: null }
  await assert.rejects(createIncomeSource(f.deps, "u1", { ...base, categoryId: "gasto" }, TODAY), InvalidIncomeSourceError)
  await assert.rejects(createIncomeSource(f.deps, "u1", { ...base, amount: 10.5 }, TODAY), InvalidIncomeSourceError)
  const created = await createIncomeSource(f.deps, "u1", { ...base, amounts: [{ month: "2026-12", amount: 53_448 }] }, TODAY)
  assert.equal(created.period.expected, 165_114)
  const [dic] = await listIncomeSources(f.deps, "u1", { year: 2026, month: 12 }, TODAY)
  assert.equal(dic.period.expected, 53_448)
  assert.deepEqual(dic.amounts, [{ month: "2026-12", amount: 53_448 }])
  const updated = await setIncomeSourceMonthAmount(f.deps, "u1", created.id, "2026-11", 100_000, TODAY)
  assert.equal(updated.period.expected, 100_000)
  const reset = await setIncomeSourceMonthAmount(f.deps, "u1", created.id, "2026-11", null, TODAY)
  assert.equal(reset.period.expected, 165_114)
  await assert.rejects(setIncomeSourceMonthAmount(f.deps, "otro", created.id, "2026-11", 1, TODAY), IncomeSourceNotFoundError)
})

// --- Conciliación ---

const reconSource = (id: string, over: Partial<NonNullable<ReconciliationState["incomeSources"]>[number]> = {}) => ({
  id,
  name: "Sueldo Acme",
  categoryId: "sueldo",
  currency: "CLP",
  amount: 1_500_000,
  dayOfMonth: 5,
  startsOn: "2026-01-01",
  endsOn: null,
  amounts: [],
  ...over,
})

const checking = (
  incomeSources: NonNullable<ReconciliationState["incomeSources"]>,
  movements: ReconciliationMovement[] = []
): ReconciliationState => ({
  accountType: "checking",
  reconciledUntil: null,
  buckets: [
    { id: "cash", kind: "cash", currency: "CLP", reconciledAt: null },
    { id: "od", kind: "overdraft", currency: "CLP", reconciledAt: null },
  ],
  movements,
  categories: [
    { id: "gasto", type: "expense" },
    { id: "sueldo", type: "income" },
    { id: "otros", type: "income" },
  ],
  incomeSources,
})

const doc = (amount: number, description = "TRANSF DE ACME SPA"): StatementDocument => ({
  snapshotAt: "2026-11-10T18:00:00-03:00",
  source: "Cartola corriente nov 2026",
  buckets: [
    { kind: "cash", currency: "CLP", limit: 0, used: 0, available: 2_000_000 },
    { kind: "overdraft", currency: "CLP", limit: 500_000, used: 0, available: 500_000 },
  ],
  rows: [{ date: "2026-11-07", description, amount, currency: "CLP", direction: "credit", kind: "income" }],
})

test("propuesta: un alta de ingreso sugiere el ÚNICO programado de su moneda con ocurrencia a ±5 días e importe ±15%; con dos candidatos no vincula", () => {
  const uno = proposeReconciliation(checking([reconSource("sueldo")]), "corriente", doc(1_400_000))
  assert.equal(uno.reconcileInput.additions[0].incomeSourceId, "sueldo")
  // Fuera del ±15%, sin categoría aprendida: no sugiere.
  const lejos = proposeReconciliation(checking([reconSource("sueldo")]), "corriente", doc(900_000))
  assert.equal(lejos.reconcileInput.additions[0].incomeSourceId, undefined)
  // Otra moneda o fuera de la ventana de días: no.
  assert.equal(
    proposeReconciliation(checking([reconSource("s", { currency: "USD" })]), "corriente", doc(1_500_000)).reconcileInput.additions[0].incomeSourceId,
    undefined
  )
  assert.equal(
    proposeReconciliation(checking([reconSource("s", { dayOfMonth: 20 })]), "corriente", doc(1_500_000)).reconcileInput.additions[0].incomeSourceId,
    undefined
  )
  // Ambiguo: dos programados calzan → sin vínculo, lo decide la persona.
  const dos = proposeReconciliation(
    checking([reconSource("a"), reconSource("b", { dayOfMonth: 8, amount: 1_450_000 })]),
    "corriente",
    doc(1_400_000)
  )
  assert.equal(dos.reconcileInput.additions[0].incomeSourceId, undefined)
  // Categoría aprendida + nombre parecido, aunque el importe no calce.
  const learned = (name: string) => ({
    ...checking([reconSource("sueldo", { name })]),
    learnedIncomeCategories: [{ normalizedText: "TRANSF DE ACME SPA", categoryId: "sueldo" }],
  })
  assert.equal(proposeReconciliation(learned("Sueldo Acme"), "corriente", doc(900_000)).reconcileInput.additions[0].incomeSourceId, "sueldo")
  // Misma categoría pero otro nombre: no basta.
  assert.equal(proposeReconciliation(learned("Arriendo depto"), "corriente", doc(900_000)).reconcileInput.additions[0].incomeSourceId, undefined)
})

test("aplicar: un alta o corrección de ingreso vinculada fija el monto de ese mes del programado a lo recibido; otra moneda se rechaza", () => {
  const now = new Date("2026-11-10T22:00:00Z")
  const state = checking([reconSource("sueldo"), reconSource("usd", { currency: "USD", amount: 500 })])
  const proposal = proposeReconciliation(state, "corriente", doc(1_400_000))
  const plan = planBankReconciliation(state, proposal.reconcileInput, now)
  assert.deepEqual(plan.incomeSourceAmounts, [{ sourceId: "sueldo", month: "2026-11", amount: 1_400_000 }])

  const wrong: BankReconciliationInput = {
    ...proposal.reconcileInput,
    additions: [{ ...proposal.reconcileInput.additions[0], incomeSourceId: "usd" }],
  }
  assert.throws(() => planBankReconciliation(state, wrong, now), /USD/)

  // Corrección de un abono de ingreso ya registrado: el vínculo explícito fija el mes.
  const abono: ReconciliationMovement = {
    id: "abono", date: "2026-11-04", description: "TRANSF DE ACME SPA", amount: 1_300_000, currency: "CLP",
    direction: "credit", categoryId: "sueldo", bucketId: "cash", status: "confirmed", isInternal: false,
    bankReceivedAt: null, linked: false, reimbursementAmount: 0, updatedAt: "2026-11-04T00:00:00Z",
    origin: "email", creditKind: "income", incomeSourceId: null,
  }
  const withAbono = checking([reconSource("sueldo")], [abono])
  const corrected = planBankReconciliation(
    withAbono,
    {
      ...proposal.reconcileInput,
      additions: [],
      corrections: [{
        transactionId: "abono", date: "2026-11-04", description: abono.description, amount: 1_350_000,
        currency: "CLP", categoryId: "sueldo", evidence: "fila 1", incomeSourceId: "sueldo",
      }],
    },
    now
  )
  assert.deepEqual(corrected.incomeSourceAmounts, [{ sourceId: "sueldo", month: "2026-11", amount: 1_350_000 }])
  assert.equal(corrected.corrections[0].after.incomeSourceId, "sueldo")
})
