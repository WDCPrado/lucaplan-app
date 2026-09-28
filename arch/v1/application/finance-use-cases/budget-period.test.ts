// Modo del período y corrección del cierre: validación, valor por defecto y cierre efectivo.
// Corre con: node --test arch/v1/application/finance-use-cases/budget-period.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  InvalidBudgetPeriodError,
  type BudgetPeriodRepository,
} from "../../domain/finance/budget-period.domain.ts"
import type { PeriodMode } from "../../../shared/billing-cycle.ts"
import {
  currentBudgetPeriod,
  getBudgetPeriod,
  rangeOf,
  setBudgetPeriodMode,
  setCardClosing,
} from "./budget-period-use-cases.ts"

// Repo en memoria con la misma forma que las filas de `app_setting`.
function memoryRepo() {
  let mode: PeriodMode | null = null
  const overrides: Record<string, string> = {}
  const repo: BudgetPeriodRepository = {
    async get() {
      return { mode, overrides: { ...overrides } }
    },
    async setMode(m) {
      mode = m
    },
    async setClosing(year, month, date) {
      const key = `${year}-${String(month).padStart(2, "0")}`
      if (date === null) delete overrides[key]
      else overrides[key] = date
    },
  }
  return { budgetPeriod: repo }
}

test("sin modo guardado (o sin repo) el período es el mes calendario", async () => {
  assert.equal((await getBudgetPeriod(memoryRepo())).mode, "calendar")
  assert.deepEqual(await rangeOf({}, 2026, 9), {
    start: "2026-09-01",
    end: "2026-09-30",
  })
})

test("modo tarjeta: el 28/09/2026 el mes en curso es octubre, 23/09 → 22/10", async () => {
  const deps = memoryRepo()
  await setBudgetPeriodMode(deps, "card_cycle")
  assert.deepEqual(await currentBudgetPeriod(deps, "2026-09-28"), {
    year: 2026,
    month: 10,
    range: { start: "2026-09-23", end: "2026-10-22" },
  })
})

test("un modo desconocido se rechaza", async () => {
  await assert.rejects(
    setBudgetPeriodMode(memoryRepo(), "weekly"),
    InvalidBudgetPeriodError
  )
})

test("corregir mayo mueve su fin y el inicio de junio; borrar vuelve al estimado", async () => {
  const deps = memoryRepo()
  await setBudgetPeriodMode(deps, "card_cycle")
  assert.deepEqual(await setCardClosing(deps, 2026, 5, "2026-05-20"), {
    date: "2026-05-20",
    estimated: false,
  })
  assert.equal((await rangeOf(deps, 2026, 5)).end, "2026-05-20")
  assert.equal((await rangeOf(deps, 2026, 6)).start, "2026-05-21")

  assert.deepEqual(await setCardClosing(deps, 2026, 5, null), {
    date: "2026-05-21",
    estimated: true,
  })
  assert.equal((await rangeOf(deps, 2026, 5)).end, "2026-05-21")
})

test("un cierre fuera del mes se rechaza y el anterior se mantiene", async () => {
  const deps = memoryRepo()
  await setCardClosing(deps, 2026, 5, "2026-05-20")
  await assert.rejects(
    setCardClosing(deps, 2026, 5, "2026-06-02"),
    InvalidBudgetPeriodError
  )
  await assert.rejects(
    setCardClosing(deps, 2026, 13, null),
    InvalidBudgetPeriodError
  )
  assert.deepEqual((await getBudgetPeriod(deps)).overrides, {
    "2026-05": "2026-05-20",
  })
})
