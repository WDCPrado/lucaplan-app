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
  payRecurringPeriodWith,
  setRecurringActive,
  setRecurringPeriodPaid,
  updateRecurringTemplate,
} from "./recurring-use-cases.ts"
import { listRecurringCandidates, listRecurringView } from "./finance-read.ts"
import { collectDueItems } from "../notification-use-cases/notify-due-use-case.ts"
import type {
  Transaction,
  TransactionRepository,
  TransactionSearchFilters,
} from "../../domain/finance/finance.domain.ts"

type Row = {
  id: string
  templateId: string
  periodKey: string
  amount: Money
  date: Date
  status: "pending" | "confirmed"
  categoryId: string
  reviewed: boolean
  externalId: string | null // id del banco; null = manual (marca del usuario o alta a mano)
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
    dropCommittedOutsideValidity: async (template) => {
      const outside = rows.filter(
        (r) =>
          r.templateId === template.id &&
          r.status === "pending" &&
          (r.date < template.startDate ||
            (template.endDate !== null && r.date > template.endDate))
      )
      for (const row of outside) rows.splice(rows.indexOf(row), 1)
      return outside.length
    },
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
        externalId: null,
      }
      rows.push(row)
      return { transactionId: row.id, created: true }
    },
    findPeriodTransaction: async (templateId, periodKey) => {
      const row = rows.find(
        (r) => r.templateId === templateId && r.periodKey === periodKey
      )
      return row
        ? { id: row.id, status: row.status, isManual: row.externalId === null }
        : null
    },
    setPeriodPaid: async (templateId, periodKey, paid) => {
      const row = rows.find(
        (r) => r.templateId === templateId && r.periodKey === periodKey
      )
      if (!row) return false
      if (row.status !== (paid ? "pending" : "confirmed")) return false
      // Deshacer solo alcanza a lo confirmado a mano, igual que el where del adapter real.
      if (!paid && row.externalId !== null) return false
      row.status = paid ? "confirmed" : "pending"
      return true
    },
    attachImportedMovement: async (transactionId, template, periodKey) => {
      const committed = rows.find(
        (r) => r.templateId === template.id && r.periodKey === periodKey
      )
      // Lo que cerró el BANCO no se pisa; una marca manual del usuario sí la reemplaza el correo.
      if (committed?.status === "confirmed" && committed.externalId !== null)
        return false
      // El importado toma el lugar de lo que hubiera: el comprometido o la marca manual.
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
        externalId: `ext-${transactionId}`,
      })
      return true
    },
  }
  // Simula el cargo real del banco confirmando el comprometido (lo hace el import, no el port).
  const confirm = (transactionId: string, amount: Money, date: Date) => {
    const row = rows.find((r) => r.id === transactionId)
    if (!row || row.status === "confirmed") return false
    row.status = "confirmed"
    row.amount = amount
    row.date = date
    row.reviewed = true
    row.externalId = `ext-${row.id}` // vino del banco: eso es lo que lo hace irreversible
    return true
  }
  return { repo, rows, confirm }
}

const arriendo: RecurringTemplate = {
  id: "arriendo",
  userId: "u1",
  accountId: "acc1",
  categoryId: "vivienda",
  label: "Arriendo depto",
  description: "ARRIENDO DEPTO",
  direction: "debit",
  baseAmount: Money.of(350_000, "CLP"),
  currency: "CLP",
  tolerancePct: 10,
  periodicity: "monthly",
  dayOfMonth: 5,
  startDate: new Date(2026, 0, 5),
  endDate: null,
  isActive: true,
  url: null,
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

// N plantillas equivalentes (misma descripción y precio) → cada cargo del período se imputa a una
// distinta; ninguno queda huérfano y todos los comprometidos se consumen.
const gym = (id: string): RecurringTemplate => ({
  ...arriendo,
  id,
  label: `Gimnasio ${id}`,
  description: "SMARTFIT",
  baseAmount: Money.of(20_000, "CLP"),
  dayOfMonth: 3,
})

test("dos plantillas equivalentes reparten un cargo a cada una", async () => {
  const gyms = [gym("g1"), gym("g2")]
  const { repo, rows } = makeRepo(gyms)
  for (const g of gyms)
    await materializePeriod({ recurring: repo }, g, new Date(2026, 6, 3))

  const cargo = {
    description: "SMARTFIT 07/26",
    amount: Money.of(20_000, "CLP"),
    direction: "debit" as const,
    date: new Date(2026, 6, 3),
  }
  const a = await confirmFromMovement({ recurring: repo }, gyms, { ...cargo, id: "c1" })
  const b = await confirmFromMovement({ recurring: repo }, gyms, { ...cargo, id: "c2" })

  // Cada cargo a una plantilla distinta; ambos comprometidos consumidos → 2 filas confirmadas.
  assert.notEqual(a?.id, b?.id)
  assert.deepEqual(new Set([a?.id, b?.id]), new Set(["g1", "g2"]))
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.status === "confirmed"))
})

test("N=3 plantillas equivalentes reparten un cargo a cada una", async () => {
  const gyms = [gym("g1"), gym("g2"), gym("g3")]
  const { repo, rows } = makeRepo(gyms)
  for (const g of gyms)
    await materializePeriod({ recurring: repo }, g, new Date(2026, 6, 3))

  const matched: (string | undefined)[] = []
  for (const id of ["c1", "c2", "c3"]) {
    const m = await confirmFromMovement({ recurring: repo }, gyms, {
      id,
      description: "SMARTFIT 07/26",
      amount: Money.of(20_000, "CLP"),
      direction: "debit",
      date: new Date(2026, 6, 3),
    })
    matched.push(m?.id)
  }
  // Los 3 cargos a las 3 plantillas, sin repetir.
  assert.deepEqual(new Set(matched), new Set(["g1", "g2", "g3"]))
  assert.equal(rows.length, 3)
  assert.ok(rows.every((r) => r.status === "confirmed"))
})

test("currentPeriodPaid: true solo cuando el período tiene cargo confirmado", async () => {
  const { repo } = makeRepo([arriendo])
  const today = new Date(2026, 6, 10) // julio 2026, dentro del período en curso
  const deps = {
    recurring: repo,
    accounts: { listByUser: async () => [{ id: "acc1", name: "Cuenta", currency: "CLP" }] },
    categories: {
      listByUser: async () => [{ id: "vivienda", name: "Vivienda", icon: null, color: null }],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  // Sin transacción del período → no cobrado.
  assert.equal((await listRecurringView(deps, "u1", today))[0].currentPeriodPaid, false)

  // Solo comprometido pending → sigue sin cobrar.
  await materializePeriod({ recurring: repo }, arriendo, today)
  assert.equal((await listRecurringView(deps, "u1", today))[0].currentPeriodPaid, false)

  // Llega el cargo real y confirma el período → cobrado.
  await confirmFromMovement({ recurring: repo }, [arriendo], {
    id: "cargo",
    description: "Arriendo Depto",
    amount: Money.of(350_000, "CLP"),
    direction: "debit",
    date: today,
  })
  assert.equal((await listRecurringView(deps, "u1", today))[0].currentPeriodPaid, true)
})

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
      label: "Gimnasio", // el usuario le pone un nombre distinto al del cargo
      direction: "debit",
      baseAmount: 17_450,
      tolerancePct: 10,
      periodicity: "monthly",
          dayOfMonth: 20,
      startDate: source.date,
      endDate: null,
      sourceTransactionId: source.id,
    }
  )

  assert.equal(template.id, "nueva")
  // La clave de match sale del cargo real, no del label; renombrar no la afecta.
  assert.equal(created[0].label, "Gimnasio")
  assert.equal(created[0].description, "Smart Fit Chile")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, "tx-origen")
  assert.equal(rows[0].templateId, "nueva")
  assert.equal(rows[0].periodKey, "2026-07")
})

test("editar guarda el enlace, lo conserva si no viene y lo borra con null", async () => {
  const { repo } = makeRepo([{ ...arriendo, url: "https://www.enel.cl" }])
  const saved: (string | null)[] = []
  repo.update = async (input) => {
    saved.push(input.url)
    return { ...arriendo, ...input, currency: "CLP" }
  }
  const deps = {
    recurring: repo,
    accounts: { findById: async () => ({ id: "acc1", userId: "u1", currency: "CLP" }) },
    categories: { findById: async () => ({ id: "c1", userId: "u1", type: "expense" }) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  const base = {
    id: arriendo.id,
    accountId: "acc1",
    categoryId: "c1",
    label: "Arriendo",
    direction: "debit" as const,
    baseAmount: 350_000,
    tolerancePct: 10,
    periodicity: "monthly" as const,
    dayOfMonth: 5,
    startDate: arriendo.startDate,
    endDate: null,
    isActive: true,
  }
  await updateRecurringTemplate(deps, "u1", base)
  await updateRecurringTemplate(deps, "u1", { ...base, url: "https://portal.aguas.cl" })
  await updateRecurringTemplate(deps, "u1", { ...base, url: null })
  assert.deepEqual(saved, ["https://www.enel.cl", "https://portal.aguas.cl", null])
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
  const { repo, rows, confirm } = makeRepo([arriendo])
  await materializePeriod({ recurring: repo }, arriendo, new Date(2026, 6, 1))
  confirm(rows[0].id, Money.of(360_000, "CLP"), new Date(2026, 6, 5))

  await repo.setCategory("arriendo", "servicios")
  assert.equal(rows[0].status, "confirmed")
  assert.equal(rows[0].categoryId, "vivienda")
})

// --- fecha de fin (WDC-31) ---

test("no se materializa el período posterior a la fecha de fin", async () => {
  const conFin = { ...arriendo, endDate: new Date(2026, 7, 31) } // termina en agosto
  const { repo, rows } = makeRepo([conFin])

  await materializeUserPeriods({ recurring: repo }, "u1", 2026, 8, new Date(2026, 7, 1))
  assert.equal(rows.length, 1, "agosto sí se abre")

  await materializeUserPeriods({ recurring: repo }, "u1", 2026, 9, new Date(2026, 7, 1))
  assert.equal(rows.length, 1, "septiembre ya no")
})

test("una plantilla terminada no reclama cargos posteriores", async () => {
  const conFin = { ...arriendo, endDate: new Date(2026, 6, 31) }
  const { repo, rows } = makeRepo([conFin])
  const matched = await confirmFromMovement({ recurring: repo }, [conFin], {
    id: "tx-agosto",
    description: "Arriendo Depto 08/26",
    amount: Money.of(355_000, "CLP"),
    direction: "debit",
    date: new Date(2026, 7, 5), // agosto, ya terminada
  })
  assert.equal(matched, null)
  assert.equal(rows.length, 0)
})

test("el cargo del último período sí lo reclama", async () => {
  const conFin = { ...arriendo, endDate: new Date(2026, 6, 31) }
  const { repo } = makeRepo([conFin])
  const matched = await confirmFromMovement({ recurring: repo }, [conFin], {
    id: "tx-julio",
    description: "Arriendo Depto 07/26",
    amount: Money.of(355_000, "CLP"),
    direction: "debit",
    date: new Date(2026, 6, 5),
  })
  assert.equal(matched?.id, "arriendo")
})

test("reactivar una terminada se rechaza hasta correr su fecha de fin", async () => {
  const conFin = {
    ...arriendo,
    isActive: false,
    endDate: new Date(2026, 6, 31),
  }
  const { repo } = makeRepo([conFin])
  repo.update = async (input) => ({ ...conFin, ...input, baseAmount: conFin.baseAmount })

  await assert.rejects(
    setRecurringActive(
      { recurring: repo },
      "u1",
      { id: "arriendo", isActive: true },
      new Date(2026, 7, 10)
    ),
    /corre su fecha de fin/
  )

  // Pausarla siempre se puede, aunque haya terminado.
  await setRecurringActive(
    { recurring: repo },
    "u1",
    { id: "arriendo", isActive: false },
    new Date(2026, 7, 10)
  )
})

test("acortar la vigencia retira los comprometidos que quedaron fuera", async () => {
  const { repo, rows } = makeRepo([arriendo])
  // Comprometidos de septiembre y octubre ya materializados.
  await materializePeriod({ recurring: repo }, arriendo, new Date(2026, 8, 1))
  await materializePeriod({ recurring: repo }, arriendo, new Date(2026, 9, 1))
  assert.equal(rows.length, 2)

  // Ahora la plantilla termina en septiembre: el de octubre ya no corresponde.
  const conFin = { ...arriendo, endDate: new Date(2026, 8, 30) }
  const dropped = await repo.dropCommittedOutsideValidity(conFin)

  assert.equal(dropped, 1)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].periodKey, "2026-09")
})

test("acortar la vigencia no toca los cobros ya confirmados", async () => {
  const { repo, rows, confirm } = makeRepo([arriendo])
  await materializePeriod({ recurring: repo }, arriendo, new Date(2026, 9, 1))
  confirm(rows[0].id, Money.of(360_000, "CLP"), new Date(2026, 9, 5))

  const conFin = { ...arriendo, endDate: new Date(2026, 8, 30) }
  const dropped = await repo.dropCommittedOutsideValidity(conFin)

  assert.equal(dropped, 0, "un cobro real se conserva aunque hoy caiga fuera")
  assert.equal(rows.length, 1)
})

// --- marca manual del cobro del período (WDC-84) ---
//
// El banco avisa cuando quiere: hasta que llega el correo el gasto sigue como comprometido y el
// presupuesto muestra plata que ya salió. La marca lo cierra; el correo, cuando llega, la corrige.

const HOY = new Date(2026, 7, 12) // agosto: dentro de la vigencia de `arriendo`

test("marcar pagado confirma el comprometido del período", async () => {
  const { repo, rows } = makeRepo([arriendo])
  await materializePeriod({ recurring: repo }, arriendo, HOY)
  assert.equal(rows[0].status, "pending")

  await setRecurringPeriodPaid({ recurring: repo }, "u1", { id: "arriendo", paid: true }, HOY)

  assert.equal(rows.length, 1, "no se crea un segundo movimiento del período")
  assert.equal(rows[0].status, "confirmed")
  assert.equal(rows[0].periodKey, "2026-08")
  assert.equal(rows[0].amount.toMajor(), 350_000, "conserva el monto base")
})

test("marcar pagado abre el período si aún no estaba materializado", async () => {
  // /recurring no materializa (solo el dashboard): marcar desde ahí tiene que abrirlo igual.
  const { repo, rows } = makeRepo([arriendo])
  assert.equal(rows.length, 0)

  await setRecurringPeriodPaid({ recurring: repo }, "u1", { id: "arriendo", paid: true }, HOY)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, "confirmed")
})

test("deshacer la marca devuelve el movimiento a comprometido", async () => {
  const { repo, rows } = makeRepo([arriendo])
  await setRecurringPeriodPaid({ recurring: repo }, "u1", { id: "arriendo", paid: true }, HOY)
  await setRecurringPeriodPaid({ recurring: repo }, "u1", { id: "arriendo", paid: false }, HOY)

  assert.equal(rows.length, 1, "el comprometido sigue existiendo: reserva la plata del mes")
  assert.equal(rows[0].status, "pending")
})

test("un cobro confirmado por el banco no se deshace a mano", async () => {
  const { repo, rows, confirm } = makeRepo([arriendo])
  await materializePeriod({ recurring: repo }, arriendo, HOY)
  confirm(rows[0].id, Money.of(360_000, "CLP"), new Date(2026, 7, 5))

  await assert.rejects(
    setRecurringPeriodPaid({ recurring: repo }, "u1", { id: "arriendo", paid: false }, HOY),
    /lo confirmó el banco/
  )
  assert.equal(rows[0].status, "confirmed")
  assert.equal(rows[0].amount.toMajor(), 360_000, "el cargo real queda intacto")
})

test("una pausada o una terminada no se marcan", async () => {
  const pausada = { ...arriendo, isActive: false }
  await assert.rejects(
    setRecurringPeriodPaid(
      { recurring: makeRepo([pausada]).repo },
      "u1",
      { id: "arriendo", paid: true },
      HOY
    ),
    /pausada/
  )

  const terminada = { ...arriendo, endDate: new Date(2026, 6, 31) }
  await assert.rejects(
    setRecurringPeriodPaid(
      { recurring: makeRepo([terminada]).repo },
      "u1",
      { id: "arriendo", paid: true },
      HOY
    ),
    /fecha de fin/
  )
})

test("marcar la recurrente de otro usuario se rechaza", async () => {
  const { repo } = makeRepo([{ ...arriendo, userId: "u2" }])
  await assert.rejects(
    setRecurringPeriodPaid({ recurring: repo }, "u1", { id: "arriendo", paid: true }, HOY)
  )
})

test("el cargo del correo reemplaza la marca manual del período", async () => {
  const { repo, rows } = makeRepo([arriendo])
  await setRecurringPeriodPaid({ recurring: repo }, "u1", { id: "arriendo", paid: true }, HOY)

  const claimed = await confirmFromMovement({ recurring: repo }, [arriendo], {
    id: "tx-banco",
    description: "Arriendo Depto 08/26",
    amount: Money.of(362_000, "CLP"),
    direction: "debit",
    date: new Date(2026, 7, 5),
  })

  assert.equal(claimed?.id, "arriendo")
  assert.equal(rows.length, 1, "el período queda con un único movimiento")
  assert.equal(rows[0].id, "tx-banco", "el del banco, no la marca manual")
  assert.notEqual(rows[0].externalId, null)
})

test("el cargo del correo no pisa un cobro que ya venía del banco", async () => {
  const { repo, rows, confirm } = makeRepo([arriendo])
  await materializePeriod({ recurring: repo }, arriendo, HOY)
  confirm(rows[0].id, Money.of(360_000, "CLP"), new Date(2026, 7, 5))

  const claimed = await confirmFromMovement({ recurring: repo }, [arriendo], {
    id: "tx-segundo",
    description: "Arriendo Depto 08/26",
    amount: Money.of(358_000, "CLP"),
    direction: "debit",
    date: new Date(2026, 7, 20),
  })

  assert.equal(claimed, null, "sigue el flujo normal de categorización")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].amount.toMajor(), 360_000)
})

// --- usar un movimiento existente como el cobro del período (WDC-108) ---
//
// El cargo real llegó con fecha de otro mes y el match automático no lo vio: el usuario lo elige.

const movimiento = (over: Partial<Transaction> = {}): Transaction => ({
  id: "tx-julio",
  userId: "u1",
  accountId: "acc1",
  categoryId: null,
  date: new Date(2026, 6, 30), // julio: fuera del período en curso (agosto)
  description: "ARRIENDO DEPTO",
  amount: Money.of(355_000, "CLP"),
  direction: "debit",
  status: "confirmed",
  isInternal: false,
  externalId: "banco-1",
  recurringTemplateId: null,
  installmentItemId: null,
  ...over,
})

const txRepo = (txs: Transaction[]) =>
  ({
    findById: async (id: string) => txs.find((t) => t.id === id) ?? null,
  }) as unknown as TransactionRepository

const pagarCon = (repo: RecurringTemplateRepository, tx: Transaction) =>
  payRecurringPeriodWith(
    { recurring: repo, transactions: txRepo([tx]) },
    "u1",
    { id: "arriendo", transactionId: tx.id },
    HOY
  )

test("un movimiento de otro mes reemplaza el comprometido del período en curso", async () => {
  const { repo, rows } = makeRepo([arriendo])
  await materializePeriod({ recurring: repo }, arriendo, HOY)

  await pagarCon(repo, movimiento())

  assert.equal(rows.length, 1, "no queda el comprometido además del cobro")
  assert.equal(rows[0].id, "tx-julio")
  assert.equal(rows[0].periodKey, "2026-08", "cuenta como el cobro de agosto")
  assert.equal(rows[0].status, "confirmed")
})

test("también abre el período si no estaba materializado y reemplaza la marca manual", async () => {
  const { repo, rows } = makeRepo([arriendo])
  await setRecurringPeriodPaid({ recurring: repo }, "u1", { id: "arriendo", paid: true }, HOY)

  await pagarCon(repo, movimiento())

  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, "tx-julio")
})

test("un período que ya cobró el banco se rechaza con 409", async () => {
  const { repo, rows, confirm } = makeRepo([arriendo])
  await materializePeriod({ recurring: repo }, arriendo, HOY)
  confirm(rows[0].id, Money.of(360_000, "CLP"), new Date(2026, 7, 5))

  await assert.rejects(pagarCon(repo, movimiento()), {
    name: "RecurringPeriodBankPaidError",
    message: "Este período ya tiene un cargo del banco",
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].amount.toMajor(), 360_000, "el cargo del banco queda intacto")
})

test("rechaza lo que no puede ser el cobro: ingreso, manual, vinculado, cuota, interno, otra moneda", async () => {
  const casos: [Partial<Transaction>, RegExp][] = [
    [{ direction: "credit" }, /ingreso/],
    [{ externalId: null }, /^Solo se pueden elegir movimientos que vinieron del banco$/],
    [{ recurringTemplateId: "otra" }, /ya es el cobro/],
    [{ installmentItemId: "item1" }, /cuota/],
    [{ isInternal: true }, /interno/],
    [{ status: "pending" }, /confirmado/],
    [{ amount: Money.of(400, "USD") }, /otra moneda/],
  ]
  for (const [over, error] of casos) {
    const { repo, rows } = makeRepo([arriendo])
    await assert.rejects(pagarCon(repo, movimiento(over)), {
      name: "InvalidRecurringTemplateError",
      message: error,
    })
    assert.equal(rows.length, 0, "no toca el período")
  }
})

test("WDC-179: un cargo del mes anterior no salda el período en curso ni borra su pendiente (ENTEL HOGAR)", async () => {
  const entel: RecurringTemplate = {
    ...arriendo,
    id: "entel",
    label: "ENTEL HOGAR",
    description: "ENTEL HOGAR",
    baseAmount: Money.of(25_990, "CLP"),
    tolerancePct: 10,
    dayOfMonth: 5,
    startDate: new Date("2026-01-05T00:00:00Z"),
  }
  const hoy = new Date("2026-11-03T15:00:00Z") // 3/11 en Chile; noviembre vence el 5
  const { repo, rows } = makeRepo([entel])
  await materializePeriod({ recurring: repo }, entel, new Date("2026-11-03T00:00:00Z"))
  const pagarEntel = (tx: Transaction) =>
    payRecurringPeriodWith(
      { recurring: repo, transactions: txRepo([tx]) },
      "u1",
      { id: "entel", transactionId: tx.id },
      hoy
    )
  const cargo = (date: string, monto = 25_990) =>
    movimiento({ id: `entel-${date}`, description: "ENTEL HOGAR", amount: Money.of(monto, "CLP"), date: new Date(`${date}T00:00:00Z`) })

  await assert.rejects(pagarEntel(cargo("2026-10-04")), {
    name: "InvalidRecurringTemplateError",
    message: "Ese cargo es del 4 de octubre y no corresponde al cobro de este período",
  })
  assert.equal(rows.length, 1, "el pendiente de noviembre sigue")
  assert.equal(rows[0].periodKey, "2026-11")
  assert.equal(rows[0].status, "pending")

  await assert.rejects(pagarEntel(cargo("2026-11-04", 40_000)), {
    name: "InvalidRecurringTemplateError",
    message: "El monto no está dentro de la tolerancia de la recurrente",
  })
  assert.equal(rows[0].status, "pending", "monto fuera de tolerancia: tampoco toca el período")

  await pagarEntel(cargo("2026-11-04"))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, "entel-2026-11-04", "el cargo del 4/11 es el cobro de noviembre")
  assert.equal(rows[0].periodKey, "2026-11")
  assert.equal(rows[0].status, "confirmed")
})

test("el movimiento de otro usuario o inexistente se rechaza como no encontrado", async () => {
  const { repo } = makeRepo([arriendo])
  await assert.rejects(pagarCon(repo, movimiento({ userId: "u2" })), {
    name: "NotOwnerError",
  })
  await assert.rejects(
    payRecurringPeriodWith(
      { recurring: repo, transactions: txRepo([]) },
      "u1",
      { id: "arriendo", transactionId: "nada" },
      HOY
    ),
    { name: "NotOwnerError" }
  )
})

test("los candidatos: del banco, sin vínculo, en su moneda, últimos N días en Chile, con texto, en la categoría de la plantilla", async () => {
  const { repo } = makeRepo([arriendo])
  let pedido: TransactionSearchFilters | undefined
  const deps = {
    recurring: repo,
    transactions: {
      searchByUser: async (_u: string, f: TransactionSearchFilters) => {
        pedido = f
        return [movimiento()]
      },
    },
    categories: { listByUser: async () => [] },
    accounts: { listByUser: async () => [] },
    exchangeRates: {},
  } as unknown as Parameters<typeof listRecurringCandidates>[0]

  // 12/08 a mediodía en Chile.
  const ahora = new Date("2026-08-12T16:00:00Z")
  const { items } = await listRecurringCandidates(deps, "u1", "arriendo", {}, ahora)

  assert.deepEqual(items.map((i) => i.id), ["tx-julio"])
  assert.equal(pedido?.direction, "debit")
  assert.equal(pedido?.currency, "CLP")
  assert.equal(pedido?.recurringCandidates, true)
  assert.equal(pedido?.settledOnly, true)
  assert.equal(pedido?.limit, 50)
  assert.equal(pedido?.amountMin, 315_000, "monto en tolerancia (350.000 ± 10 %)")
  assert.equal(pedido?.amountMax, 385_000, "monto en tolerancia (350.000 ± 10 %)")
  assert.equal(pedido?.query, undefined)
  assert.equal(pedido?.categoryId, "vivienda", "siempre la categoría de la plantilla")
  // Vence el 5/08: hasta 10 días después entran, aunque sean futuros.
  assert.equal(pedido?.to?.toISOString(), "2026-08-15T00:00:00.000Z", "hasta 10 días después del vencimiento")
  assert.equal(pedido?.from?.toISOString(), "2026-08-02T00:00:00.000Z", "10 días por defecto")

  // Más días no ofrecen lo que el vínculo rechazaría: nunca antes de 10 días del vencimiento.
  await listRecurringCandidates(deps, "u1", "arriendo", { days: 30 }, ahora)
  assert.equal(pedido?.from?.toISOString(), "2026-07-26T00:00:00.000Z")

  // Pasadas las 20:00 en Chile ya es otro día en UTC: manda el día de Chile (31/08 sigue en agosto).
  await listRecurringCandidates(deps, "u1", "arriendo", { days: 1 }, new Date("2026-09-01T02:00:00Z"))
  assert.equal(pedido?.from?.toISOString(), "2026-08-30T00:00:00.000Z")
  assert.equal(pedido?.to?.toISOString(), "2026-08-15T00:00:00.000Z", "el período sigue siendo agosto")

  await listRecurringCandidates(
    deps,
    "u1",
    "arriendo",
    { query: "arriendo" },
    ahora
  )
  assert.equal(pedido?.query, "arriendo")

  for (const days of [0, 366, 1.5, Number.NaN])
    await assert.rejects(
      listRecurringCandidates(deps, "u1", "arriendo", { days }, ahora),
      { name: "InvalidRecurringTemplateError", message: /entre 1 y 365/ },
      String(days)
    )

  await assert.rejects(listRecurringCandidates(deps, "u2", "arriendo", {}, ahora), {
    name: "NotOwnerError",
  })
})

test("un correo posterior del mismo período no borra el movimiento elegido", async () => {
  const { repo, rows } = makeRepo([arriendo])
  await pagarCon(repo, movimiento())

  const claimed = await confirmFromMovement({ recurring: repo }, [arriendo], {
    id: "tx-correo",
    description: "Arriendo Depto 08/26",
    amount: Money.of(355_000, "CLP"),
    direction: "debit",
    date: new Date(2026, 7, 5),
  })

  assert.equal(claimed, null, "el período ya tiene su cargo del banco")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, "tx-julio", "el elegido sigue siendo el cobro")
})

test("una recurrente de ingreso se paga con un abono y pide abonos como candidatos", async () => {
  const sueldo: RecurringTemplate = {
    ...arriendo,
    id: "sueldo",
    categoryId: "sueldo",
    label: "Sueldo",
    description: "SUELDO",
    direction: "credit",
  }
  const { repo, rows } = makeRepo([sueldo])
  const abono = movimiento({ id: "abono-julio", direction: "credit" })
  const conSueldo = (tx: Transaction) =>
    payRecurringPeriodWith(
      { recurring: repo, transactions: txRepo([tx]) },
      "u1",
      { id: "sueldo", transactionId: tx.id },
      HOY
    )

  await assert.rejects(conSueldo(movimiento()), {
    name: "InvalidRecurringTemplateError",
    message: /Un gasto no puede/,
  })
  await conSueldo(abono)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, "abono-julio")
  assert.equal(rows[0].periodKey, "2026-08")

  let pedido: TransactionSearchFilters | undefined
  const deps = {
    recurring: repo,
    transactions: {
      searchByUser: async (_u: string, f: TransactionSearchFilters) => {
        pedido = f
        return []
      },
    },
    categories: { listByUser: async () => [] },
    accounts: { listByUser: async () => [] },
    exchangeRates: {},
  } as unknown as Parameters<typeof listRecurringCandidates>[0]
  await listRecurringCandidates(deps, "u1", "sueldo", {}, HOY)
  assert.equal(pedido?.direction, "credit")
})

test("pagar con movimiento: plantilla ajena → no encontrada; pausada o terminada → 422", async () => {
  await assert.rejects(
    pagarCon(makeRepo([{ ...arriendo, userId: "u2" }]).repo, movimiento()),
    { name: "NotOwnerError" }
  )
  await assert.rejects(
    pagarCon(makeRepo([{ ...arriendo, isActive: false }]).repo, movimiento()),
    { name: "InvalidRecurringTemplateError", message: /pausada/ }
  )
  await assert.rejects(
    pagarCon(makeRepo([{ ...arriendo, endDate: new Date(2026, 6, 31) }]).repo, movimiento()),
    { name: "InvalidRecurringTemplateError", message: /fecha de fin/ }
  )
})

test("si el vínculo falla porque el movimiento cambió en medio, no responde 409", async () => {
  // El repo rechaza el vínculo; la segunda lectura del movimiento dice por qué.
  const conCambio = (despues: Transaction | null) => {
    const { repo } = makeRepo([arriendo])
    repo.attachImportedMovement = async () => false
    let lecturas = 0
    const transactions = {
      findById: async () => (lecturas++ === 0 ? movimiento() : despues),
    } as unknown as TransactionRepository
    return payRecurringPeriodWith(
      { recurring: repo, transactions },
      "u1",
      { id: "arriendo", transactionId: "tx-julio" },
      HOY
    )
  }
  await assert.rejects(conCambio(null), { name: "NotOwnerError" })
  await assert.rejects(conCambio(movimiento({ recurringTemplateId: "otra" })), {
    name: "InvalidRecurringTemplateError",
    message: /ya es el cobro/,
  })
  // El movimiento sigue igual: fue el período el que cambió (lo cerró el correo).
  await assert.rejects(conCambio(movimiento()), {
    name: "RecurringPeriodBankPaidError",
  })
})

test("el recordatorio de vencimiento calla si el período se pagó con un cargo de otro mes", async () => {
  const hoy = new Date(2026, 8, 4, 12) // 4/09: el arriendo vence el 5
  const { repo } = makeRepo([arriendo])
  const deps = {
    recurring: repo,
    installments: { listByUser: async () => [] },
  } as unknown as Parameters<typeof collectDueItems>[0]

  const antes = await collectDueItems(deps, "u1", hoy, 2)
  assert.equal(antes.length, 1, "sin pagar, avisa")

  // El cargo llegó el 30/08 y se eligió como el cobro de septiembre.
  await payRecurringPeriodWith(
    {
      recurring: repo,
      transactions: txRepo([movimiento({ date: new Date(2026, 7, 30) })]),
    },
    "u1",
    { id: "arriendo", transactionId: "tx-julio" },
    hoy
  )
  const despues = await collectDueItems(deps, "u1", hoy, 2)
  assert.deepEqual(despues, [], "el período 2026-09 ya está cobrado")
})

test("createRecurringTemplate: rechaza un movimiento que ya es el cobro de otra recurrente", async () => {
  let created = false
  const deps = {
    recurring: {
      create: async () => {
        created = true
        return {}
      },
    },
    accounts: {
      findById: async () => ({ id: "acc1", userId: "u1", currency: "CLP" }),
    },
    categories: {
      findById: async () => ({ id: "c1", userId: "u1", type: "expense" }),
    },
    transactions: {
      findById: async () => ({
        id: "tx1",
        userId: "u1",
        description: "Smart Fit Chile",
        recurringTemplateId: "otra",
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  await assert.rejects(
    () =>
      createRecurringTemplate(deps, "u1", {
        accountId: "acc1",
        categoryId: "c1",
        label: "Gimnasio",
        direction: "debit",
        baseAmount: 17_450,
        tolerancePct: 10,
        periodicity: "monthly",
        dayOfMonth: 20,
        startDate: new Date(2026, 6, 20),
        endDate: null,
        sourceTransactionId: "tx1",
      }),
    /ya es el cobro de una recurrente/
  )
  assert.equal(created, false)
})
