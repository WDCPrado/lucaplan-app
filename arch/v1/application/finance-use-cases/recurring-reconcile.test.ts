// Corre con: node --test arch/v1/application/finance-use-cases/recurring-reconcile.test.ts
// WDC-171 · Conciliación de recurrentes con el cargo del banco (sin doble conteo), el período que
// salda un cargo en el borde de mes y el «hoy» del usuario en Chile.
//
// Caso de uso PROPUESTO (no existe aún): `confirmFromMovements(deps, templates, movements)` en
// recurring-use-cases.ts. Recibe el LOTE de cargos recién importados (lo que hoy recorre
// `matchRecurringForImported`), cada uno con su `accountId`, y devuelve Map<movementId, plantilla>
// con los que quedaron vinculados. Lo pide la regla «ese cargo es el único que calza con ella»: la
// unicidad se mide dentro del lote. Se lee por el namespace para que el resto del archivo cargue y
// cada test falle por su cuenta; cuando exista, pasar a import directo.
//
// Ventana supuesta: ±10 días calendario alrededor del vencimiento del período (`executionDateFor`),
// inclusive. Reúsa los 10 días que ya usa `listRecurringCandidates` (finance-read.ts) para elegir
// el cobro de un período.
//
// TZ: los tests de borde de mes y de «hoy» corren dos veces, con TZ=America/Santiago y TZ=UTC,
// cambiando `process.env.TZ` en caliente (helper `enCadaZona`).
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import {
  executionDateFor,
  type MovementForMatch,
  type RecurringTemplate,
  type RecurringTemplateRepository,
} from "../../domain/finance/recurring.domain.ts"
import * as uc from "./recurring-use-cases.ts"
import { materializeUserPeriods, setRecurringPeriodPaid } from "./recurring-use-cases.ts"

type Cargo = MovementForMatch & { id: string; date: Date; accountId: string }
type ConfirmFromMovements = (
  deps: { recurring: RecurringTemplateRepository },
  templates: RecurringTemplate[],
  movements: Cargo[]
) => Promise<Map<string, RecurringTemplate>>

const confirmFromMovements: ConfirmFromMovements = (...args) => {
  const fn = (uc as unknown as { confirmFromMovements?: ConfirmFromMovements })
    .confirmFromMovements
  if (typeof fn !== "function")
    throw new Error("falta el caso de uso confirmFromMovements")
  return fn(...args)
}

const d = (day: string) => new Date(`${day}T00:00:00.000Z`) // como llega un @db.Date

async function enCadaZona(fn: (tz: string) => Promise<void>) {
  const prev = process.env.TZ
  try {
    for (const tz of ["America/Santiago", "UTC"]) {
      process.env.TZ = tz
      await fn(tz)
    }
  } finally {
    if (prev === undefined) delete process.env.TZ
    else process.env.TZ = prev
  }
}

// --- Repo en memoria: único (plantilla, período); lo que cerró el banco no se pisa ---

type Row = {
  id: string
  templateId: string
  periodKey: string
  status: "pending" | "confirmed"
  externalId: string | null // null = comprometido o marca manual «Ya lo pagué»
}

function makeRepo(templates: RecurringTemplate[]) {
  const rows: Row[] = []
  let seq = 0
  const find = (templateId: string, periodKey: string) =>
    rows.find((r) => r.templateId === templateId && r.periodKey === periodKey)
  const noUsado = async (): Promise<never> => {
    throw new Error("no usado")
  }
  const repo: RecurringTemplateRepository = {
    listByUser: async () => templates,
    listActiveByUser: async () => templates.filter((t) => t.isActive),
    listAllActive: async () => templates.filter((t) => t.isActive),
    findById: async (id) => templates.find((t) => t.id === id) ?? null,
    create: noUsado,
    update: noUsado,
    delete: async () => {},
    dropCommittedOutsideValidity: async () => 0,
    setCategory: async () => {},
    materializePeriod: async (template, periodKey) => {
      const existing = find(template.id, periodKey)
      if (existing) return { transactionId: existing.id, created: false }
      const row: Row = {
        id: `pend${++seq}`,
        templateId: template.id,
        periodKey,
        status: "pending",
        externalId: null,
      }
      rows.push(row)
      return { transactionId: row.id, created: true }
    },
    listOpenPeriods: async (templateId) =>
      rows
        .filter(
          (r) =>
            r.templateId === templateId &&
            (r.status === "pending" || r.externalId === null)
        )
        .map((r) => ({ periodKey: r.periodKey, isManual: r.status === "confirmed" })),
    findPeriodTransaction: async (templateId, periodKey) => {
      const row = find(templateId, periodKey)
      // Sin fecha en la fila: el cargo se lee como del vencimiento de su período.
      const template = templates.find((t) => t.id === templateId)!
      return row
        ? {
            id: row.id,
            status: row.status,
            isManual: row.externalId === null,
            date: executionDateFor(template, periodKey),
          }
        : null
    },
    setPeriodPaid: async (templateId, periodKey, paid) => {
      const row = find(templateId, periodKey)
      if (!row || row.status !== (paid ? "pending" : "confirmed")) return false
      if (!paid && row.externalId !== null) return false
      row.status = paid ? "confirmed" : "pending"
      return true
    },
    attachImportedMovement: async (transactionId, template, periodKey) => {
      const committed = find(template.id, periodKey)
      if (committed?.status === "confirmed" && committed.externalId !== null)
        return false
      if (rows.some((r) => r.id === transactionId)) return false // ya es de otra plantilla
      if (committed) rows.splice(rows.indexOf(committed), 1)
      rows.push({
        id: transactionId,
        templateId: template.id,
        periodKey,
        status: "confirmed",
        externalId: `ext-${transactionId}`,
      })
      return true
    },
  }
  // Abre el comprometido del período (lo que hace el dashboard/cron).
  const abrir = (template: RecurringTemplate, periodKey: string) =>
    repo.materializePeriod(template, periodKey, executionDateFor(template, periodKey))
  // Estado del período, en palabras: libre (no abierto), comprometido, marcado a mano o el id
  // del cargo del banco que lo saldó.
  const estado = (templateId: string, periodKey: string): string => {
    const row = find(templateId, periodKey)
    if (!row) return "sin abrir"
    if (row.status === "pending") return "comprometido"
    return row.externalId === null ? "marcado a mano" : row.id
  }
  return { repo, rows, abrir, estado }
}

// --- Datos ---

const arriendo: RecurringTemplate = {
  id: "arriendo",
  userId: "u1",
  accountId: "cuenta-corriente",
  categoryId: "vivienda",
  label: "Arriendo depto",
  description: "ARRIENDO DEPTO",
  direction: "debit",
  baseAmount: Money.of(350_000, "CLP"), // ±10% → 315.000 a 385.000
  currency: "CLP",
  tolerancePct: 10,
  periodicity: "monthly",
  dayOfMonth: 5,
  startDate: d("2026-01-05"),
  endDate: null,
  isActive: true,
  url: null,
}

// Vence el último día: 31 en octubre, 30 en noviembre, 28/29 en febrero.
const arriendo31: RecurringTemplate = {
  ...arriendo,
  id: "arriendo31",
  dayOfMonth: 31,
  startDate: d("2026-01-31"),
}

const cargo = (
  id: string,
  fecha: string,
  monto: number,
  texto = "TRANSF PAGO ARR 4471",
  accountId = "cuenta-corriente"
): Cargo => ({
  id,
  description: texto,
  amount: Money.of(monto, "CLP"),
  direction: "debit",
  date: d(fecha),
  accountId,
})

// ¿Un cargo suelto concilia el arriendo de octubre (vence 5-oct, comprometido)? Repo nuevo por caso.
async function conciliaOctubre(fecha: string, monto: number, accountId?: string) {
  const { repo, abrir, estado } = makeRepo([arriendo])
  await abrir(arriendo, "2026-10")
  const claimed = await confirmFromMovements({ recurring: repo }, [arriendo], [
    cargo("c1", fecha, monto, undefined, accountId),
  ])
  return { claimed: claimed.get("c1")?.id ?? null, octubre: estado("arriendo", "2026-10") }
}

// --- Regla 1: conciliar aunque el texto difiera, si es el único candidato ---

test("rec-01 · Dado el arriendo de octubre comprometido, cuando llega un cargo con otro texto pero misma cuenta y monto en tolerancia, entonces salda octubre y el gasto cuenta una sola vez", async () => {
  const { repo, rows, abrir, estado } = makeRepo([arriendo])
  await abrir(arriendo, "2026-10")

  const claimed = await confirmFromMovements({ recurring: repo }, [arriendo], [
    cargo("c1", "2026-10-06", 352_000),
  ])

  assert.equal(claimed.get("c1")?.id, "arriendo")
  assert.equal(estado("arriendo", "2026-10"), "c1", "el cargo es el cobro de octubre")
  assert.equal(rows.length, 1, "no queda el comprometido además del cargo")
})

test("rec-02 · La ventana es de 10 días alrededor del vencimiento: vence el 5-oct, concilia del 25-sep al 15-oct y no fuera", async () => {
  for (const [fecha, esperado] of [
    ["2026-10-15", "arriendo"], // +10: en el borde
    ["2026-10-16", null], // +11: fuera
    ["2026-09-25", "arriendo"], // −10: cargo adelantado, en el borde
    ["2026-09-24", null], // −11: fuera
  ] as const) {
    const r = await conciliaOctubre(fecha, 350_000)
    assert.equal(r.claimed, esperado, fecha)
    assert.equal(r.octubre, esperado ? "c1" : "comprometido", fecha)
  }
})

test("rec-03 · Un cargo con otro texto y monto fuera de la tolerancia no concilia: el arriendo sigue comprometido", async () => {
  for (const [monto, esperado] of [
    [385_000, "arriendo"], // +10%: borde
    [385_001, null],
    [315_000, "arriendo"], // −10%: borde
    [314_999, null],
  ] as const) {
    const r = await conciliaOctubre("2026-10-06", monto)
    assert.equal(r.claimed, esperado, String(monto))
    assert.equal(r.octubre, esperado ? "c1" : "comprometido", String(monto))
  }
})

test("rec-04 · Un cargo con otro texto en otra cuenta no concilia aunque el monto y la fecha calcen", async () => {
  const r = await conciliaOctubre("2026-10-06", 350_000, "tarjeta-credito")
  assert.equal(r.claimed, null)
  assert.equal(r.octubre, "comprometido")
})

test("rec-05 · Dos recurrentes pendientes calzan con el mismo cargo (arriendo y gasto común): no concilia ninguna y queda para resolver a mano", async () => {
  // Gasto común 340.000 ±10% → 306.000 a 374.000, misma cuenta, mismo vencimiento.
  const gastoComun: RecurringTemplate = {
    ...arriendo,
    id: "gasto-comun",
    label: "Gasto común",
    description: "GASTOS COMUNES EDIF",
    baseAmount: Money.of(340_000, "CLP"),
  }
  const ambas = [arriendo, gastoComun]

  const a = makeRepo(ambas)
  for (const t of ambas) await a.abrir(t, "2026-10")
  const ninguno = await confirmFromMovements({ recurring: a.repo }, ambas, [
    cargo("c1", "2026-10-06", 345_000),
  ])
  assert.equal(ninguno.size, 0)
  assert.equal(a.estado("arriendo", "2026-10"), "comprometido")
  assert.equal(a.estado("gasto-comun", "2026-10"), "comprometido")

  // Borde: 380.000 solo cabe en el arriendo (el gasto común llega a 374.000) → único, concilia.
  const b = makeRepo(ambas)
  for (const t of ambas) await b.abrir(t, "2026-10")
  const uno = await confirmFromMovements({ recurring: b.repo }, ambas, [
    cargo("c1", "2026-10-06", 380_000),
  ])
  assert.equal(uno.get("c1")?.id, "arriendo")
  assert.equal(b.estado("gasto-comun", "2026-10"), "comprometido")
})

test("rec-06 · Dos cargos del lote calzan con el arriendo pendiente: no concilia ninguno; si solo uno calza, ese concilia", async () => {
  const a = makeRepo([arriendo])
  await a.abrir(arriendo, "2026-10")
  const ninguno = await confirmFromMovements({ recurring: a.repo }, [arriendo], [
    cargo("c1", "2026-10-06", 352_000),
    cargo("c2", "2026-10-07", 349_000, "TEF A CORREDORA"),
  ])
  assert.equal(ninguno.size, 0)
  assert.equal(a.estado("arriendo", "2026-10"), "comprometido")

  // Borde: el segundo cargo se sale de la tolerancia → el primero es el único candidato.
  const b = makeRepo([arriendo])
  await b.abrir(arriendo, "2026-10")
  const uno = await confirmFromMovements({ recurring: b.repo }, [arriendo], [
    cargo("c1", "2026-10-06", 352_000),
    cargo("c2", "2026-10-07", 500_000, "TEF A CORREDORA"),
  ])
  assert.equal(uno.get("c1")?.id, "arriendo")
  assert.equal(uno.has("c2"), false)
})

test("rec-07 · El texto idéntico concilia como siempre: gana sobre otro candidato del lote, aunque llegue 15 días tarde y aunque sea de otra cuenta", async () => {
  // Con un cargo de texto idéntico y otro de texto distinto en el lote, el idéntico salda octubre
  // y el otro queda libre (no hay doble conteo ni empate).
  const a = makeRepo([arriendo])
  await a.abrir(arriendo, "2026-10")
  const lote = await confirmFromMovements({ recurring: a.repo }, [arriendo], [
    cargo("c1", "2026-10-06", 350_000, "Arriendo Depto 10/26"),
    cargo("c2", "2026-10-06", 352_000),
  ])
  assert.equal(lote.get("c1")?.id, "arriendo")
  assert.equal(lote.has("c2"), false)
  assert.equal(a.estado("arriendo", "2026-10"), "c1")

  // Fuera de la ventana de 10 días pero en el mismo mes: hoy concilia por texto y sigue igual.
  const b = makeRepo([arriendo])
  await b.abrir(arriendo, "2026-10")
  const tarde = await confirmFromMovements({ recurring: b.repo }, [arriendo], [
    cargo("c1", "2026-10-20", 350_000, "ARRIENDO DEPTO"),
  ])
  assert.equal(tarde.get("c1")?.id, "arriendo")
  assert.equal(b.estado("arriendo", "2026-10"), "c1")

  // Supuesto: el texto idéntico no mira la cuenta (como hoy).
  const c = makeRepo([arriendo])
  await c.abrir(arriendo, "2026-10")
  const otraCuenta = await confirmFromMovements({ recurring: c.repo }, [arriendo], [
    cargo("c1", "2026-10-06", 350_000, "ARRIENDO DEPTO", "tarjeta-credito"),
  ])
  assert.equal(otraCuenta.get("c1")?.id, "arriendo")
})

test("rec-08 · Un cargo con otro texto reemplaza la marca «Ya lo pagué» de octubre, pero no pisa un cobro que ya vino del banco", async () => {
  const a = makeRepo([arriendo])
  await a.abrir(arriendo, "2026-10")
  await a.repo.setPeriodPaid("arriendo", "2026-10", true)
  const reemplaza = await confirmFromMovements({ recurring: a.repo }, [arriendo], [
    cargo("c1", "2026-10-06", 352_000),
  ])
  assert.equal(reemplaza.get("c1")?.id, "arriendo")
  assert.equal(a.estado("arriendo", "2026-10"), "c1", "el cargo real toma el lugar de la marca")

  const b = makeRepo([arriendo])
  await b.abrir(arriendo, "2026-10")
  await b.repo.attachImportedMovement("banco-1", arriendo, "2026-10")
  const noPisa = await confirmFromMovements({ recurring: b.repo }, [arriendo], [
    cargo("c2", "2026-10-07", 352_000),
  ])
  assert.equal(noPisa.size, 0)
  assert.equal(b.estado("arriendo", "2026-10"), "banco-1")
})

test("rec-09 · Una recurrente planificada (sin texto del banco todavía) concilia su primer cargo si es el único candidato", async () => {
  const planificada: RecurringTemplate = { ...arriendo, id: "plan", description: "" }
  const { repo, abrir, estado } = makeRepo([planificada])
  await abrir(planificada, "2026-10")
  const claimed = await confirmFromMovements({ recurring: repo }, [planificada], [
    cargo("c1", "2026-10-05", 350_000, "TRANSF A JUAN PEREZ"),
  ])
  assert.equal(claimed.get("c1")?.id, "plan")
  assert.equal(estado("plan", "2026-10"), "c1")
})

test("rec-10 · Un cargo adelantado salda el período que viene: octubre ya lo cobró el banco y el 30-oct llega el arriendo de noviembre (vence 5-nov)", async () => {
  const { repo, abrir, estado } = makeRepo([arriendo])
  await abrir(arriendo, "2026-10")
  await repo.attachImportedMovement("banco-oct", arriendo, "2026-10")
  await abrir(arriendo, "2026-11")

  const claimed = await confirmFromMovements({ recurring: repo }, [arriendo], [
    cargo("c1", "2026-10-30", 350_000, "ARRIENDO DEPTO"),
  ])

  assert.equal(claimed.get("c1")?.id, "arriendo", "no se va a la IA como gasto suelto")
  assert.equal(estado("arriendo", "2026-11"), "c1")
  assert.equal(estado("arriendo", "2026-10"), "banco-oct")
})

// --- Regla 2: el borde de mes salda el pendiente más antiguo dentro de la ventana ---

test("rec-11 · Un arriendo que vence el 31-oct y se cobra el 1-nov salda octubre, no noviembre (texto idéntico o distinto, en Chile y en UTC)", async () => {
  await enCadaZona(async (tz) => {
    for (const texto of ["ARRIENDO DEPTO", "TRANSF PAGO ARR 4471"]) {
      const { repo, abrir, estado } = makeRepo([arriendo31])
      await abrir(arriendo31, "2026-10") // vence 31-oct
      await abrir(arriendo31, "2026-11") // vence 30-nov
      const claimed = await confirmFromMovements({ recurring: repo }, [arriendo31], [
        cargo("c1", "2026-11-01", 350_000, texto),
      ])
      assert.equal(claimed.get("c1")?.id, "arriendo31", `${tz} · ${texto}`)
      assert.equal(estado("arriendo31", "2026-10"), "c1", `${tz} · ${texto}: octubre saldado`)
      assert.equal(estado("arriendo31", "2026-11"), "comprometido", `${tz} · ${texto}: noviembre intacto`)
    }
  })
})

test("rec-12 · Febrero: un arriendo del día 31 vence el 28 (29 en bisiesto) y el cargo del 1-mar salda febrero", async () => {
  await enCadaZona(async (tz) => {
    assert.equal(executionDateFor(arriendo31, "2027-02").toISOString(), "2027-02-28T00:00:00.000Z", tz)
    assert.equal(executionDateFor(arriendo31, "2028-02").toISOString(), "2028-02-29T00:00:00.000Z", tz)

    for (const [feb, marzo] of [
      ["2027-02", "2027-03-01"],
      ["2028-02", "2028-03-01"],
    ]) {
      const { repo, abrir, estado } = makeRepo([arriendo31])
      await abrir(arriendo31, feb)
      const claimed = await confirmFromMovements({ recurring: repo }, [arriendo31], [
        cargo("c1", marzo, 350_000, "ARRIENDO DEPTO"),
      ])
      assert.equal(claimed.get("c1")?.id, "arriendo31", `${tz} · ${marzo}`)
      assert.equal(estado("arriendo31", feb), "c1", `${tz} · ${feb} saldado`)
    }
  })
})

test("rec-13 · Con dos quincenas pendientes dentro de la ventana, el cargo salda la más antigua y el siguiente cargo la otra", async () => {
  // Nana quincenal desde el 9-oct: vence 23-oct (Q01) y 6-nov (Q02). El 30-oct está a 7 días de ambas.
  const nana: RecurringTemplate = {
    ...arriendo,
    id: "nana",
    description: "PAGO NANA",
    baseAmount: Money.of(120_000, "CLP"),
    tolerancePct: 5,
    periodicity: "biweekly",
    dayOfMonth: null,
    startDate: d("2026-10-09"),
  }
  await enCadaZona(async (tz) => {
    const { repo, abrir, estado } = makeRepo([nana])
    await abrir(nana, "2026-Q01")
    await abrir(nana, "2026-Q02")
    const primero = await confirmFromMovements({ recurring: repo }, [nana], [
      cargo("c1", "2026-10-30", 120_000, "TEF MARIA SOTO"),
    ])
    assert.equal(primero.get("c1")?.id, "nana", tz)
    assert.equal(estado("nana", "2026-Q01"), "c1", `${tz}: la más antigua primero`)
    assert.equal(estado("nana", "2026-Q02"), "comprometido", tz)

    const segundo = await confirmFromMovements({ recurring: repo }, [nana], [
      cargo("c2", "2026-11-05", 120_000, "TEF MARIA SOTO"),
    ])
    assert.equal(segundo.get("c2")?.id, "nana", tz)
    assert.equal(estado("nana", "2026-Q02"), "c2", tz)
  })
})

// --- Regla 3: «hoy» es el día civil en Chile ---

// 22:00 del 31-oct en Chile (−03) = 01:00 UTC del 1-nov. 00:30 del 1-nov en Chile = 03:30 UTC.
const NOCHE_31_OCT = new Date("2026-11-01T01:00:00.000Z")
const ULTIMO_MINUTO_31_OCT = new Date("2026-11-01T02:59:00.000Z")
const MADRUGADA_1_NOV = new Date("2026-11-01T03:30:00.000Z")

test("rec-14 · «Ya lo pagué» a las 22:00 de Chile del 31-oct marca octubre, y también sirve el último día de una recurrente que termina el 31-oct", async () => {
  const conFin: RecurringTemplate = { ...arriendo, endDate: d("2026-10-31") }
  await enCadaZona(async (tz) => {
    for (const ahora of [NOCHE_31_OCT, ULTIMO_MINUTO_31_OCT]) {
      const { repo, estado } = makeRepo([conFin])
      const at = `${tz} · ${ahora.toISOString()}`
      await setRecurringPeriodPaid({ recurring: repo }, "u1", { id: "arriendo", paid: true }, ahora)
      assert.equal(estado("arriendo", "2026-10"), "marcado a mano", at)
      assert.equal(estado("arriendo", "2026-11"), "sin abrir", at)

      await setRecurringPeriodPaid({ recurring: repo }, "u1", { id: "arriendo", paid: false }, ahora)
      assert.equal(estado("arriendo", "2026-10"), "comprometido", `${at}: deshacer vuelve octubre`)
    }

    // Borde: a las 00:30 del 1-nov en Chile la recurrente ya terminó.
    const { repo } = makeRepo([conFin])
    await assert.rejects(
      setRecurringPeriodPaid({ recurring: repo }, "u1", { id: "arriendo", paid: true }, MADRUGADA_1_NOV),
      { name: "InvalidRecurringTemplateError", message: /ya terminó/ },
      tz
    )
  })
})

test("rec-15 · Abrir el mes a las 22:00 de Chile del 31-oct abre octubre (no lo trata como pasado); a las 00:30 del 1-nov octubre ya es pasado", async () => {
  await enCadaZona(async (tz) => {
    const a = makeRepo([arriendo31])
    assert.equal(
      await materializeUserPeriods({ recurring: a.repo }, "u1", 2026, 10, NOCHE_31_OCT),
      1,
      `${tz}: octubre sigue siendo el mes en curso`
    )
    assert.equal(a.estado("arriendo31", "2026-10"), "comprometido", tz)
    assert.equal(
      await materializeUserPeriods({ recurring: a.repo }, "u1", 2026, 11, NOCHE_31_OCT),
      1,
      `${tz}: noviembre se abre como mes futuro`
    )
    assert.equal(a.estado("arriendo31", "2026-11"), "comprometido", tz)

    const b = makeRepo([arriendo31])
    assert.equal(
      await materializeUserPeriods({ recurring: b.repo }, "u1", 2026, 10, MADRUGADA_1_NOV),
      0,
      `${tz}: octubre ya pasó`
    )
    assert.equal(b.rows.length, 0, tz)
  })
})

test("rec-16 · Un segundo NETFLIX.COM cuando octubre ya lo cobró el banco no concilia otra recurrente de la misma cuenta y monto (SMARTFIT pendiente)", async () => {
  const base = { ...arriendo, baseAmount: Money.of(9_990, "CLP"), tolerancePct: 0 }
  const netflix: RecurringTemplate = { ...base, id: "netflix", label: "Netflix", description: "NETFLIX.COM" }
  const smartfit: RecurringTemplate = { ...base, id: "smartfit", label: "Smartfit", description: "SMARTFIT" }
  const { repo, abrir, estado } = makeRepo([netflix, smartfit])
  await abrir(netflix, "2026-10")
  await abrir(smartfit, "2026-10")
  await repo.attachImportedMovement("banco-netflix", netflix, "2026-10")
  const claimed = await confirmFromMovements({ recurring: repo }, [netflix, smartfit], [
    cargo("c1", "2026-10-06", 9_990, "NETFLIX.COM"),
  ])
  assert.equal(claimed.size, 0)
  assert.equal(estado("smartfit", "2026-10"), "comprometido")
  assert.equal(estado("netflix", "2026-10"), "banco-netflix")
})
