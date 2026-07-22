// Corre con: node --test arch/v1/application/finance-use-cases/recurring.test.ts
// Repo en memoria que replica los invariantes que la BD impone: único (plantilla, período) y
// confirmación que no pisa una ejecución previa.
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import {
  type RecurringTemplate,
  type RecurringTemplateRepository,
} from "../../domain/finance/recurring.domain.ts"
import {
  confirmFromMovement,
  createRecurringTemplate,
  materializePeriod,
  materializeUserPeriods,
  runRecurringCron,
} from "./recurring-use-cases.ts"

type Row = {
  id: string
  templateId: string
  periodKey: string
  amount: Money
  date: Date
  status: "pending" | "confirmed"
  categoryId: string
  reviewed: boolean
}

function makeRepo(templates: RecurringTemplate[]) {
  const rows: Row[] = []
  let seq = 0
  const repo: RecurringTemplateRepository = {
    listByUser: async () => templates,
    listActiveByUser: async () => templates.filter((t) => t.isActive),
    listAllActive: async () => templates.filter((t) => t.isActive),
    findById: async (id) => templates.find((t) => t.id === id) ?? null,
    create: async () => {
      throw new Error("no usado")
    },
    update: async () => {
      throw new Error("no usado")
    },
    delete: async () => {},
    setCategory: async (templateId, categoryId) => {
      for (const r of rows)
        if (r.templateId === templateId && r.status === "pending")
          r.categoryId = categoryId
    },
    materializePeriod: async (template, periodKey, date) => {
      const existing = rows.find(
        (r) => r.templateId === template.id && r.periodKey === periodKey
      )
      if (existing) return { transactionId: existing.id, created: false }
      const row: Row = {
        id: `tx${++seq}`,
        templateId: template.id,
        periodKey,
        amount: template.baseAmount,
        date,
        status: "pending",
        categoryId: template.categoryId,
        reviewed: false,
      }
      rows.push(row)
      return { transactionId: row.id, created: true }
    },
    findPeriodTransaction: async (templateId, periodKey) => {
      const row = rows.find(
        (r) => r.templateId === templateId && r.periodKey === periodKey
      )
      return row ? { id: row.id, status: row.status } : null
    },
    confirmPeriod: async (transactionId, amount, date) => {
      const row = rows.find((r) => r.id === transactionId)
      if (!row || row.status === "confirmed") return false
      row.status = "confirmed"
      row.amount = amount
      row.date = date
      row.reviewed = true
      return true
    },
    attachImportedMovement: async (transactionId, template, periodKey) => {
      const committed = rows.find(
        (r) => r.templateId === template.id && r.periodKey === periodKey
      )
      if (committed?.status === "confirmed") return false
      // El importado toma el lugar del comprometido, que se consume.
      if (committed) rows.splice(rows.indexOf(committed), 1)
      rows.push({
        id: transactionId,
        templateId: template.id,
        periodKey,
        amount: Money.of(0, "CLP"), // el monto real lo trae el movimiento importado
        date: new Date(),
        status: "confirmed",
        categoryId: template.categoryId,
        reviewed: true,
      })
      return true
    },
  }
  return { repo, rows }
}

const arriendo: RecurringTemplate = {
  id: "arriendo",
  userId: "u1",
  accountId: "acc1",
  categoryId: "vivienda",
  description: "ARRIENDO DEPTO",
  direction: "debit",
  baseAmount: Money.of(350_000, "CLP"),
  currency: "CLP",
  tolerancePct: 10,
  periodicity: "monthly",
  executionMode: "email_detection",
  dayOfMonth: 5,
  startDate: new Date(2026, 0, 5),
  isActive: true,
}

test("materializar el período crea un pending y no duplica al repetir", async () => {
  const { repo, rows } = makeRepo([arriendo])
  const first = await materializePeriod({ recurring: repo }, arriendo, new Date(2026, 6, 1))
  const second = await materializePeriod({ recurring: repo }, arriendo, new Date(2026, 6, 20))
  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.equal(second.transactionId, first.transactionId)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, "pending")
})

test("el cargo importado consume el comprometido y queda un solo movimiento", async () => {
  const { repo, rows } = makeRepo([arriendo])
  await materializePeriod({ recurring: repo }, arriendo, new Date(2026, 6, 1))
  const matched = await confirmFromMovement({ recurring: repo }, [arriendo], {
    id: "importado1",
    description: "Arriendo Depto 07/26",
    amount: Money.of(362_000, "CLP"),
    direction: "debit",
    date: new Date(2026, 6, 5),
  })
  assert.equal(matched?.id, "arriendo")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, "importado1")
  assert.equal(rows[0].status, "confirmed")
  assert.equal(rows[0].categoryId, "vivienda")
  assert.equal(rows[0].reviewed, true)
})

test("segundo cargo del mismo período no se vincula (sigue a la IA)", async () => {
  const { repo, rows } = makeRepo([arriendo])
  const movement = {
    description: "Arriendo Depto 07/26",
    amount: Money.of(355_000, "CLP"),
    direction: "debit" as const,
    date: new Date(2026, 6, 5),
  }
  await confirmFromMovement({ recurring: repo }, [arriendo], { ...movement, id: "tx-a" })
  const second = await confirmFromMovement({ recurring: repo }, [arriendo], {
    ...movement,
    id: "tx-b",
  })
  assert.equal(second, null)
  assert.equal(rows.length, 1)
})

test("cargo fuera del rango no lo reclama ninguna plantilla", async () => {
  const { repo, rows } = makeRepo([arriendo])
  const matched = await confirmFromMovement({ recurring: repo }, [arriendo], {
    id: "tx1",
    description: "Arriendo Depto 07/26",
    amount: Money.of(500_000, "CLP"),
    direction: "debit",
    date: new Date(2026, 6, 5),
  })
  assert.equal(matched, null)
  assert.equal(rows.length, 0)
})

test("cron: materializa y confirma solo cuando llegó el día", async () => {
  const cuota = { ...arriendo, id: "cuota", executionMode: "cron" as const, dayOfMonth: 10 }
  const { repo, rows } = makeRepo([cuota])

  const antes = await runRecurringCron({ recurring: repo }, new Date(2026, 6, 3))
  assert.equal(antes.materialized, 1)
  assert.equal(antes.confirmed, 0)
  assert.equal(rows[0].status, "pending")

  const elDia = await runRecurringCron({ recurring: repo }, new Date(2026, 6, 10))
  assert.equal(elDia.materialized, 0)
  assert.equal(elDia.confirmed, 1)
  assert.equal(rows[0].status, "confirmed")

  const otraVez = await runRecurringCron({ recurring: repo }, new Date(2026, 6, 10))
  assert.equal(otraVez.confirmed, 0)
  assert.equal(otraVez.skipped, 1)
  assert.equal(rows.length, 1)
})

test("cron: la plantilla de correo se materializa pero no se confirma sola", async () => {
  const { repo, rows } = makeRepo([arriendo])
  const result = await runRecurringCron({ recurring: repo }, new Date(2026, 6, 20))
  assert.equal(result.materialized, 1)
  assert.equal(result.confirmed, 0)
  assert.equal(rows[0].status, "pending")
})

test("cron: plantilla inactiva no compromete nada", async () => {
  const { repo, rows } = makeRepo([{ ...arriendo, isActive: false }])
  const result = await runRecurringCron({ recurring: repo }, new Date(2026, 6, 20))
  assert.equal(result.materialized, 0)
  assert.equal(rows.length, 0)
})

test("cron: plantilla que aún no empieza se omite", async () => {
  const futura = { ...arriendo, startDate: new Date(2027, 0, 5) }
  const { repo, rows } = makeRepo([futura])
  const result = await runRecurringCron({ recurring: repo }, new Date(2026, 6, 20))
  assert.equal(result.materialized, 0)
  assert.equal(result.skipped, 1)
  assert.equal(rows.length, 0)
})

// El movimiento desde el que se crea la plantilla debe quedar vinculado como la ejecución de su
// período: sin esto queda huérfano (sin sello ni acciones en la UI) y el mes volvería a
// materializar un comprometido por un gasto que ya se cobró.
test("crear desde un movimiento lo vincula como ejecución de su período", async () => {
  const { repo, rows } = makeRepo([])
  const created: RecurringTemplate[] = []
  repo.create = async (input) => {
    const t = {
      ...input,
      id: "nueva",
      currency: "CLP" as const,
      isActive: true,
    }
    created.push(t)
    return t
  }
  const source = {
    id: "tx-origen",
    userId: "u1",
    accountId: "acc1",
    categoryId: "subscripciones",
    date: new Date(2026, 6, 20),
    description: "Smart Fit Chile",
    amount: Money.of(17_450, "CLP"),
    direction: "debit" as const,
    status: "confirmed" as const,
    isInternal: false,
    externalId: "ext-1",
  }

  const template = await createRecurringTemplate(
    {
      recurring: repo,
      accounts: {
        findById: async () => ({
          id: "acc1",
          userId: "u1",
          currency: "CLP",
        }),
      },
      categories: {
        findById: async () => ({
          id: "subscripciones",
          userId: "u1",
          type: "expense",
        }),
      },
      transactions: { findById: async () => source },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    "u1",
    {
      accountId: "acc1",
      categoryId: "subscripciones",
      description: "Smart Fit Chile",
      direction: "debit",
      baseAmount: 17_450,
      tolerancePct: 10,
      periodicity: "monthly",
      executionMode: "email_detection",
      dayOfMonth: 20,
      startDate: source.date,
      sourceTransactionId: source.id,
    }
  )

  assert.equal(template.id, "nueva")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, "tx-origen")
  assert.equal(rows[0].templateId, "nueva")
  assert.equal(rows[0].periodKey, "2026-07")
})

// El comprometido no puede depender solo del cron: la vista lo materializa al abrirse (idempotente).
test("materializa el período del mes en curso y no duplica al recargar", async () => {
  const { repo, rows } = makeRepo([arriendo])
  const hoy = new Date(2026, 7, 12) // 12 de agosto de 2026
  assert.equal(await materializeUserPeriods({ recurring: repo }, "u1", 2026, 8, hoy), 1)
  assert.equal(await materializeUserPeriods({ recurring: repo }, "u1", 2026, 8, hoy), 0)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].periodKey, "2026-08")
  assert.equal(rows[0].status, "pending")
})

test("un mes futuro abre su período; uno pasado no inventa historia", async () => {
  const { repo, rows } = makeRepo([arriendo])
  const hoy = new Date(2026, 7, 12)
  assert.equal(await materializeUserPeriods({ recurring: repo }, "u1", 2026, 9, hoy), 1)
  assert.equal(rows[0].periodKey, "2026-09")
  assert.equal(await materializeUserPeriods({ recurring: repo }, "u1", 2026, 6, hoy), 0)
  assert.equal(rows.length, 1)
})

test("plantilla pausada no compromete el mes", async () => {
  const { repo, rows } = makeRepo([{ ...arriendo, isActive: false }])
  const materialized = await materializeUserPeriods(
    { recurring: repo },
    "u1",
    2026,
    8,
    new Date(2026, 7, 12)
  )
  assert.equal(materialized, 0)
  assert.equal(rows.length, 0)
})

// La categoría fluye en una sola dirección: del movimiento a la plantilla. Recategorizar el
// movimiento reencauza la plantilla y sus comprometidos aún no cobrados.
test("recategorizar el movimiento arrastra plantilla y comprometidos", async () => {
  const { repo, rows } = makeRepo([arriendo])
  await materializePeriod({ recurring: repo }, arriendo, new Date(2026, 7, 1))
  assert.equal(rows[0].categoryId, "vivienda")

  await repo.setCategory("arriendo", "servicios")
  assert.equal(rows[0].categoryId, "servicios")
})

test("lo ya cobrado no cambia de categoría al reencauzar la plantilla", async () => {
  const { repo, rows } = makeRepo([arriendo])
  await materializePeriod({ recurring: repo }, arriendo, new Date(2026, 6, 1))
  await repo.confirmPeriod(rows[0].id, Money.of(360_000, "CLP"), new Date(2026, 6, 5))

  await repo.setCategory("arriendo", "servicios")
  assert.equal(rows[0].status, "confirmed")
  assert.equal(rows[0].categoryId, "vivienda")
})
