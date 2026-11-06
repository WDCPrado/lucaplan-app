// WDC-179: el vínculo viejo guardó cargos en el período siguiente (ENTEL HOGAR, ENEL, AGUAS ANDINAS:
// el cargo del 4-oct quedó en 2026-11 y noviembre se veía «Pagado»). `materializePeriod` los
// devuelve al período de su fecha sin pisar otro cargo real ni una marca manual.
// Sin base de datos: `client.ts` reutiliza `globalThis.prisma`, así que se deja un Prisma falso
// ANTES de importar el repo. Cubre solo lo que usa `materializePeriod`.
// Corre con: node --test arch/v1/infrastructure/database/prisma/recurring-misplaced.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../../domain/finance/money.ts"
import type { RecurringTemplate } from "../../../domain/finance/recurring.domain.ts"

type Row = {
  id: string
  recurringTemplateId: string
  periodKey: string
  status: "pending" | "confirmed"
  externalId: string | null
  transactionDate: Date
  amount: string
}
let rows: Row[] = []
let seq = 0

const matches = (r: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => r[k as keyof Row] === v)

const fake: Record<string, unknown> = {
  transaction: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((r) => matches(r, where)) ?? null,
    findFirstOrThrow: async ({ where }: { where: Record<string, unknown> }) => {
      const row = rows.find((r) => matches(r, where))
      if (!row) throw new Error("no existe")
      return row
    },
    create: async ({ data }: { data: Omit<Row, "id"> }) => {
      if (rows.some((r) => r.recurringTemplateId === data.recurringTemplateId && r.periodKey === data.periodKey))
        throw new Error("P2002")
      const row = { ...data, id: `pend${++seq}` } as Row
      rows.push(row)
      return row
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const before = rows.length
      rows = rows.filter((r) => !matches(r, where))
      return { count: before - rows.length }
    },
    update: async ({ where, data }: { where: { id: string }; data: { periodKey: string } }) => {
      const row = rows.find((r) => r.id === where.id)!
      // El único (plantilla, período) de la BD.
      if (rows.some((r) => r !== row && r.recurringTemplateId === row.recurringTemplateId && r.periodKey === data.periodKey))
        throw new Error("único plantilla+período")
      row.periodKey = data.periodKey
      return row
    },
  },
  // Transacción de mentira: restaura las filas si el callback lanza.
  $transaction: async (fn: (db: unknown) => Promise<unknown>) => {
    const snapshot = rows.map((r) => ({ ...r }))
    try {
      return await fn(fake)
    } catch (e) {
      rows = snapshot
      throw e
    }
  },
}
;(globalThis as unknown as { prisma: unknown }).prisma = fake

const { recurringTemplateRepository } = await import("./recurring.infrastructure.ts")

const d = (day: string) => new Date(`${day}T00:00:00.000Z`)
const template = (id: string): RecurringTemplate => ({
  id,
  userId: "u1",
  accountId: "acc1",
  categoryId: "servicios",
  label: id,
  description: id.toUpperCase(),
  direction: "debit",
  baseAmount: Money.of(25_990, "CLP"),
  currency: "CLP",
  tolerancePct: 10,
  periodicity: "monthly",
  dayOfMonth: 5,
  startDate: d("2026-01-05"),
  endDate: null,
  isActive: true,
  url: null,
})
const entel = template("entel")
const row = (over: Partial<Row> & Pick<Row, "id" | "periodKey" | "transactionDate">): Row => ({
  recurringTemplateId: entel.id,
  status: "confirmed",
  externalId: `bch-${over.id}`,
  amount: "25990",
  ...over,
})
const byPeriod = () =>
  Object.fromEntries(rows.map((r) => [r.periodKey, { id: r.id, status: r.status }]))
const materializarNoviembre = () =>
  recurringTemplateRepository.materializePeriod(entel, "2026-11", d("2026-11-05"))

test("WDC-179: el cargo del 4-oct guardado en noviembre vuelve a octubre y noviembre queda comprometido", async () => {
  rows = [row({ id: "cargo-oct", periodKey: "2026-11", transactionDate: d("2026-10-04") })]
  const { created } = await materializarNoviembre()
  assert.equal(created, true)
  assert.deepEqual(byPeriod(), {
    "2026-10": { id: "cargo-oct", status: "confirmed" },
    "2026-11": { id: "pend1", status: "pending" },
  })
  assert.equal(rows.find((r) => r.id === "cargo-oct")!.amount, "25990", "no toca el monto")
  assert.equal(rows.find((r) => r.id === "cargo-oct")!.transactionDate.toISOString(), d("2026-10-04").toISOString())

  // Idempotente: otra corrida no mueve ni crea nada.
  const again = await materializarNoviembre()
  assert.equal(again.created, false)
  assert.equal(rows.length, 2)
})

test("WDC-179: el comprometido que quedó en octubre se borra para hacerle lugar al cargo", async () => {
  rows = [
    row({ id: "pend-oct", periodKey: "2026-10", transactionDate: d("2026-10-05"), status: "pending", externalId: null }),
    row({ id: "cargo-oct", periodKey: "2026-11", transactionDate: d("2026-10-04") }),
  ]
  await materializarNoviembre()
  assert.equal(rows.some((r) => r.id === "pend-oct"), false)
  assert.equal(byPeriod()["2026-10"].id, "cargo-oct")
  assert.equal(byPeriod()["2026-11"].status, "pending")
})

test("WDC-179: octubre con otro cargo real o con marca manual no se pisa; el cargo se queda en noviembre", async () => {
  for (const ocupante of [
    row({ id: "otro-cargo", periodKey: "2026-10", transactionDate: d("2026-10-06") }),
    row({ id: "marca", periodKey: "2026-10", transactionDate: d("2026-10-05"), externalId: null }),
  ]) {
    rows = [ocupante, row({ id: "cargo-oct", periodKey: "2026-11", transactionDate: d("2026-10-04") })]
    const { transactionId, created } = await materializarNoviembre()
    assert.equal(created, false)
    assert.equal(transactionId, "cargo-oct")
    assert.deepEqual(byPeriod(), {
      "2026-10": { id: ocupante.id, status: "confirmed" },
      "2026-11": { id: "cargo-oct", status: "confirmed" },
    })
  }
})

test("WDC-179: ARRIENDO pagado el 5-nov y un cargo atrasado legítimo no se mueven", async () => {
  // Cargo real del período: se queda.
  rows = [row({ id: "arriendo-nov", periodKey: "2026-11", transactionDate: d("2026-11-05") })]
  await materializarNoviembre()
  assert.deepEqual(byPeriod(), { "2026-11": { id: "arriendo-nov", status: "confirmed" } })

  // Octubre pagado tarde, el 3-nov: posterior al vencimiento, es el cobro de octubre.
  rows = [row({ id: "atrasado", periodKey: "2026-10", transactionDate: d("2026-11-03") })]
  await recurringTemplateRepository.materializePeriod(entel, "2026-10", d("2026-10-05"))
  assert.deepEqual(byPeriod(), { "2026-10": { id: "atrasado", status: "confirmed" } })
})

test("WDC-179: vence el 28 y el cargo del 4-oct es el atrasado de septiembre: va a septiembre, no a octubre", async () => {
  const dia28 = { ...entel, dayOfMonth: 28, startDate: d("2026-01-28") }
  rows = [
    row({ id: "pend-oct", periodKey: "2026-10", transactionDate: d("2026-10-28"), status: "pending", externalId: null }),
    row({ id: "cargo", periodKey: "2026-11", transactionDate: d("2026-10-04") }),
  ]
  await recurringTemplateRepository.materializePeriod(dia28, "2026-11", d("2026-11-28"))
  assert.deepEqual(byPeriod()["2026-09"], { id: "cargo", status: "confirmed" })
  assert.deepEqual(byPeriod()["2026-10"], { id: "pend-oct", status: "pending" }, "octubre sigue por cobrar")
  assert.equal(byPeriod()["2026-11"].status, "pending")
})

test("WDC-179: sin un período vigente que el cargo pueda pagar, no se mueve (quincenal antes del inicio)", async () => {
  const quincenal = { ...entel, periodicity: "biweekly" as const, dayOfMonth: null, startDate: d("2026-10-20") }
  rows = [row({ id: "cargo", periodKey: "2026-Q01", transactionDate: d("2026-10-01") })]
  await recurringTemplateRepository.materializePeriod(quincenal, "2026-Q01", d("2026-11-03"))
  assert.deepEqual(byPeriod(), { "2026-Q01": { id: "cargo", status: "confirmed" } })
})
