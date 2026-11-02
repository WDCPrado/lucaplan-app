// WDC-171: el correo «Pago de tarjeta de crédito» ya no salda cuotas `card` (se saldan al conciliar
// la factura); el pago de una cuota de crédito de consumo sigue enganchándose solo.
// Sin base de datos: `client.ts` reutiliza `globalThis.prisma` si existe, así que se deja ahí un
// Prisma falso en memoria ANTES de importar el módulo. El falso cubre solo las llamadas que hacen
// `runInstallmentsForImported` y el repo de cuotas.
// Corre con: node --test arch/v1/infrastructure/database/prisma/run-installments.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"

type Item = {
  id: string
  index: number
  dueDate: Date
  amount: string
  paidOutsideApp: boolean
  transaction: { id: string } | null
}
type Plan = {
  id: string
  userId: string
  kind: "card" | "loan"
  accountId: string
  categoryId: string
  sourceTransactionId: string | null
  description: string
  totalAmount: string
  currency: "CLP" | "USD"
  installmentsCount: number
  startDate: Date
  dayOfMonth: number
  tolerancePct: number
  completedAt: Date | null
  items: Item[]
}
type Row = {
  id: string
  userId: string
  externalId: string
  accountId: string
  amount: string
  currency: string
  transactionDate: Date
  description: string
  isInternal: boolean
  installmentItemId: string | null
}

const utc = (s: string) => new Date(`${s}T00:00:00Z`)

const db = {
  plans: [] as Plan[],
  rows: [] as Row[],
  created: [] as { installmentItemId: string; amount: string }[],
}
const itemById = (id: string) =>
  db.plans.flatMap((p) => p.items).find((i) => i.id === id) ?? null

const fakePrisma = {
  transaction: {
    findMany: async ({ where }: { where: { userId: string; externalId: { in: string[] } } }) =>
      db.rows
        .filter(
          (r) =>
            r.userId === where.userId &&
            where.externalId.in.includes(r.externalId) &&
            r.installmentItemId === null
        )
        .sort((a, b) => +a.transactionDate - +b.transactionDate),
    create: async ({ data }: { data: { installmentItemId: string; amount: string } }) => {
      const item = itemById(data.installmentItemId)!
      item.transaction = { id: `tx-${item.id}` }
      db.created.push({ installmentItemId: data.installmentItemId, amount: data.amount })
      return { id: `tx-${item.id}` }
    },
    updateMany: async ({ where, data }: { where: { id: string }; data: { installmentItemId: string } }) => {
      const row = db.rows.find((r) => r.id === where.id && r.installmentItemId === null)
      if (!row) return { count: 0 }
      row.installmentItemId = data.installmentItemId
      itemById(data.installmentItemId)!.transaction = { id: row.id }
      return { count: 1 }
    },
  },
  installmentPlan: {
    findMany: async ({ where }: { where: { accountId: string; kind: string } }) =>
      structuredClone(
        db.plans.filter(
          (p) => p.accountId === where.accountId && p.kind === where.kind && p.completedAt === null
        )
      ),
    update: async ({ where, data }: { where: { id: string }; data: { completedAt: Date | null } }) => {
      db.plans.find((p) => p.id === where.id)!.completedAt = data.completedAt
    },
  },
  installmentItem: {
    findUnique: async ({ where }: { where: { id: string } }) => structuredClone(itemById(where.id)),
    updateMany: async () => ({ count: 0 }),
  },
  $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(fakePrisma),
}
;(globalThis as unknown as { prisma: unknown }).prisma = fakePrisma

const { runInstallmentsForImported } = await import("./run-installments.ts")
const { installmentPlanRepository } = await import("./installment.infrastructure.ts")

function cardPlan(over: Partial<Plan> & { id: string }): Plan {
  const currency = over.currency ?? "CLP"
  const amount = currency === "USD" ? "50.00" : "100000"
  return {
    userId: "u1",
    kind: "card",
    accountId: "tarjeta",
    categoryId: "cat",
    sourceTransactionId: "compra",
    description: "Notebook",
    totalAmount: currency === "USD" ? "300.00" : "600000",
    currency,
    installmentsCount: 6,
    startDate: utc("2026-08-05"),
    dayOfMonth: 5,
    tolerancePct: 0,
    completedAt: null,
    items: ["08", "09", "10", "11", "12"].map((m, i) => ({
      id: `${over.id}-i${i + 1}`,
      index: i + 1,
      dueDate: utc(`2026-${m}-05`),
      amount,
      paidOutsideApp: false,
      transaction: null,
    })),
    ...over,
  }
}

function cardPayment(id: string, date: string, amount: string): Row {
  return {
    id,
    userId: "u1",
    externalId: `ext-${id}`,
    accountId: "tarjeta",
    amount,
    currency: "CLP",
    transactionDate: utc(date),
    description: "Pago de tarjeta de crédito",
    isInternal: true,
    installmentItemId: null,
  }
}

function reset(plans: Plan[], rows: Row[]) {
  db.plans = plans
  db.rows = rows
  db.created = []
}
const settledIds = () =>
  db.plans.flatMap((p) => p.items.filter((i) => i.transaction).map((i) => i.id))

test("Dado la tarjeta con el plan Notebook ($100.000 por cuota) y un plan en dólares, ambos con cuotas vencidas, cuando llega el correo «Pago de tarjeta de crédito» por $850.000, entonces el pago no salda ninguna cuota ni crea su movimiento", async () => {
  reset(
    [cardPlan({ id: "notebook" }), cardPlan({ id: "vuelo", currency: "USD", description: "Vuelo" })],
    [cardPayment("pago1", "2026-10-25", "850000")]
  )
  const registered = await runInstallmentsForImported("u1", ["ext-pago1"])
  assert.equal(registered, 0, "no se registra ninguna cuota")
  assert.deepEqual(db.created, [], "no se crea movimiento de cuota")
  assert.deepEqual(settledIds(), [], "las cuotas de agosto, septiembre y octubre siguen pendientes")
  assert.ok(db.plans.every((p) => p.completedAt === null))
})

test("Dado el plan Notebook con dos cuotas atrasadas, cuando en el mismo ciclo pago la tarjeta en dos partes ($300.000 el 10-10 y $550.000 el 24-10), entonces ninguno de los dos pagos salda una cuota", async () => {
  reset(
    [cardPlan({ id: "notebook" })],
    [cardPayment("p1", "2026-10-10", "300000"), cardPayment("p2", "2026-10-24", "550000")]
  )
  // Llegan en dos importaciones separadas, como dos correos.
  assert.equal(await runInstallmentsForImported("u1", ["ext-p1"]), 0)
  assert.equal(await runInstallmentsForImported("u1", ["ext-p2"]), 0)
  // Y reprocesar los dos juntos tampoco.
  assert.equal(await runInstallmentsForImported("u1", ["ext-p1", "ext-p2"]), 0)
  assert.deepEqual(settledIds(), [])
  assert.deepEqual(db.created, [])
})

test("Dado una tarjeta sin planes de cuotas, cuando llega el correo de pago, entonces se procesa sin error y no registra nada", async () => {
  reset([], [cardPayment("p1", "2026-10-25", "120000")])
  assert.equal(await runInstallmentsForImported("u1", ["ext-p1"]), 0)
  assert.deepEqual(db.created, [])
})

test("Dado un crédito de consumo de $100.000 por cuota en la cuenta corriente, cuando llega el cargo «Pago Crédito de Consumo» por $100.000, entonces se engancha solo a la cuota de agosto sin crear otro movimiento", async () => {
  const loan: Plan = {
    ...cardPlan({ id: "credito" }),
    kind: "loan",
    accountId: "corriente",
    sourceTransactionId: null,
    description: "Crédito Consumo",
    tolerancePct: 10,
  }
  reset(
    [loan],
    [
      {
        id: "cargo",
        userId: "u1",
        externalId: "ext-cargo",
        accountId: "corriente",
        amount: "100000",
        currency: "CLP",
        transactionDate: utc("2026-08-07"),
        description: "Pago Crédito de Consumo",
        isInternal: false,
        installmentItemId: null,
      },
    ]
  )
  const registered = await runInstallmentsForImported("u1", ["ext-cargo"])
  assert.equal(registered, 1, "solo la cuota del crédito")
  assert.equal(itemById("credito-i1")!.transaction?.id, "cargo", "adopta el cargo que ya llegó")
  assert.deepEqual(db.created, [], "no se crea ningún movimiento nuevo")
})

test("Dado la cuota de octubre del Notebook ($100.000) vencida e impaga, cuando miro el presupuesto de octubre, entonces cuenta $100.000 como comprometido; al saldarla deja de contar", async () => {
  const { committedForMonth } = await import("../../../domain/finance/installment.domain.ts")
  const octubre = { start: "2026-10-01", end: "2026-10-31" }
  reset([cardPlan({ id: "notebook" })], [])
  const [plan] = await installmentPlanRepository.listActiveByAccount("tarjeta", "card")
  assert.equal(committedForMonth(plan, octubre).toMajor(), 100_000)
  // Saldada (al conciliar la factura), deja de contar: nunca cuenta dos veces.
  itemById("notebook-i3")!.transaction = { id: "pagada-al-conciliar" }
  const [after] = await installmentPlanRepository.listActiveByAccount("tarjeta", "card")
  assert.equal(committedForMonth(after, octubre).toMajor(), 0)
})
