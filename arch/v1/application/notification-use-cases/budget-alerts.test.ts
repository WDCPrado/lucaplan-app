// Corre con: node --test arch/v1/application/notification-use-cases/budget-alerts.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DuplicateBudgetAlertError,
  InvalidBudgetAlertError,
  type BudgetAlert,
  type BudgetAlertRepository,
} from "../../domain/notifications/budget-alert.domain.ts"
import {
  deleteBudgetAlert,
  listBudgetAlerts,
  saveBudgetAlert,
} from "./budget-alert-use-cases.ts"

// Repo en memoria que replica el invariante de la BD: `percent` único.
function makeRepo(initial: BudgetAlert[] = []) {
  let rows = [...initial]
  let seq = initial.length
  const repo: BudgetAlertRepository = {
    async list() {
      return [...rows]
    },
    async save({ id, percent }) {
      if (id) {
        rows = rows.map((r) => (r.id === id ? { ...r, percent } : r))
        return rows.find((r) => r.id === id)!
      }
      const created = { id: `a${++seq}`, percent }
      rows.push(created)
      return created
    },
    async delete(id) {
      rows = rows.filter((r) => r.id !== id)
    },
  }
  return { deps: { budgetAlerts: repo }, rows: () => rows }
}

test("los umbrales se listan de menor a mayor", async () => {
  const { deps } = makeRepo([
    { id: "a1", percent: 100 },
    { id: "a2", percent: 50 },
    { id: "a3", percent: 80 },
  ])
  assert.deepEqual(
    (await listBudgetAlerts(deps)).map((a) => a.percent),
    [50, 80, 100]
  )
})

test("crear y mover umbrales", async () => {
  const { deps, rows } = makeRepo([{ id: "a1", percent: 80 }])
  const nuevo = await saveBudgetAlert(deps, { percent: 50 })
  assert.equal(nuevo.percent, 50)
  // Mover uno existente no crea otro.
  await saveBudgetAlert(deps, { id: "a1", percent: 90 })
  assert.deepEqual(rows().map((r) => r.percent).sort((a, b) => a - b), [50, 90])
  // Decimales se redondean: medio punto porcentual no cambia ninguna decisión.
  const redondeado = await saveBudgetAlert(deps, { percent: 70.4 })
  assert.equal(redondeado.percent, 70)
})

test("rechaza duplicados y porcentajes fuera de rango", async () => {
  const { deps, rows } = makeRepo([
    { id: "a1", percent: 80 },
    { id: "a2", percent: 100 },
  ])
  await assert.rejects(
    () => saveBudgetAlert(deps, { percent: 80 }),
    DuplicateBudgetAlertError
  )
  // Mover uno sobre otro existente también es duplicado...
  await assert.rejects(
    () => saveBudgetAlert(deps, { id: "a1", percent: 100 }),
    DuplicateBudgetAlertError
  )
  // ...pero guardar un umbral en su propio valor no lo es.
  await saveBudgetAlert(deps, { id: "a1", percent: 80 })

  await assert.rejects(
    () => saveBudgetAlert(deps, { percent: 0 }),
    InvalidBudgetAlertError
  )
  // El techo es 100: sobre eso el aviso ya reporta el % real alcanzado.
  await assert.rejects(
    () => saveBudgetAlert(deps, { percent: 120 }),
    InvalidBudgetAlertError
  )
  assert.equal(rows().length, 2) // ningún rechazo dejó basura
})

test("eliminar un umbral lo saca de la lista", async () => {
  const { deps } = makeRepo([
    { id: "a1", percent: 80 },
    { id: "a2", percent: 100 },
  ])
  await deleteBudgetAlert(deps, "a1")
  assert.deepEqual(
    (await listBudgetAlerts(deps)).map((a) => a.percent),
    [100]
  )
})
