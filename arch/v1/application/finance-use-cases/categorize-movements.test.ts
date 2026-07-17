// Categorización con IA: regla de lado, validación de id fuera de conjunto y skip elegante.
// Corre con: node --test arch/v1/application/finance-use-cases/categorize-movements.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type {
  Category,
  Direction,
  Transaction,
} from "../../domain/finance/finance.domain.ts"
import type { CategorizationProvider } from "../../domain/finance/categorization.port.ts"
import {
  categorizeMovements,
  type CategorizeDeps,
} from "./categorize-movements-use-case.ts"

const cat = (id: string, type: "income" | "expense"): Category => ({
  id,
  userId: "u1",
  name: id,
  type,
  icon: null,
  color: null,
  description: null,
})

const mov = (id: string, direction: Direction): Transaction => ({
  id,
  userId: "u1",
  accountId: "a1",
  categoryId: null,
  date: new Date("2026-07-01"),
  description: `mov ${id}`,
  amount: Money.of(1000, "CLP"),
  direction,
  status: "confirmed",
  isInternal: false,
  externalId: `mov_${id}`,
})

// Deps con categorías fijas, un provider inyectable y un registro de las asignaciones aplicadas.
function makeDeps(provider: CategorizationProvider, categories: Category[]) {
  const applied: { id: string; categoryId: string | null }[] = []
  const deps: CategorizeDeps = {
    categorization: provider,
    categories: {
      async listByUser() {
        return categories
      },
      async findById() {
        return null
      },
      async upsert() {
        throw new Error("no usado")
      },
      async listLimitsByUser() {
        return []
      },
      async setLimit() {
        throw new Error("no usado")
      },
    },
    transactions: {
      async listByUserPeriod() {
        return []
      },
      async listByCategoryPeriod() {
        return []
      },
      async searchByUser() {
        return []
      },
      async create() {
        throw new Error("no usado")
      },
      async findById() {
        return null
      },
      async update() {
        throw new Error("no usado")
      },
      async setCategory(id, categoryId) {
        applied.push({ id, categoryId })
        return mov(id, "debit")
      },
      // La IA escribe por aquí (condicional). Por defecto siempre "gana"; los tests de carrera
      // lo sobrescriben con un store con estado.
      async setCategoryIfUncategorized(id, categoryId) {
        applied.push({ id, categoryId })
        return true
      },
      async delete() {},
      async importMovements() {
        return []
      },
    },
  }
  return { deps, applied }
}

test("categorizeMovements: solo ofrece categorías del mismo lado (gasto↔debit, ingreso↔credit)", async () => {
  // El provider ecoa las categorías candidatas que recibió, por lado.
  let debitCats: string[] = []
  let creditCats: string[] = []
  const provider: CategorizationProvider = {
    async categorize({ movements, categories }) {
      const ids = categories.map((c) => c.id)
      if (movements[0].direction === "debit") debitCats = ids
      else creditCats = ids
      return Object.fromEntries(
        movements.map((m) => [m.id, categories[0]?.id ?? null])
      )
    },
  }
  const { deps, applied } = makeDeps(provider, [
    cat("gasto1", "expense"),
    cat("ingreso1", "income"),
  ])
  await categorizeMovements(deps, "u1", [mov("d", "debit"), mov("c", "credit")])

  assert.deepEqual(debitCats, ["gasto1"]) // al débito solo se le ofrecen categorías de gasto
  assert.deepEqual(creditCats, ["ingreso1"]) // al crédito solo las de ingreso
  assert.equal(applied.find((a) => a.id === "d")?.categoryId, "gasto1")
  assert.equal(applied.find((a) => a.id === "c")?.categoryId, "ingreso1")
})

test("categorizeMovements: un id fuera del conjunto permitido no se aplica (queda sin categoría)", async () => {
  const provider: CategorizationProvider = {
    async categorize({ movements }) {
      return Object.fromEntries(movements.map((m) => [m.id, "ingreso1"])) // id de ingreso para un débito
    },
  }
  const { deps, applied } = makeDeps(provider, [
    cat("gasto1", "expense"),
    cat("ingreso1", "income"),
  ])
  await categorizeMovements(deps, "u1", [mov("d", "debit")])
  assert.equal(applied.length, 0) // el id cruzado no se aplica
})

test("categorizeMovements: provider que falla no lanza y no asigna (skip elegante)", async () => {
  const provider: CategorizationProvider = {
    async categorize() {
      throw new Error("boom")
    },
  }
  const { deps, applied } = makeDeps(provider, [cat("gasto1", "expense")])
  const assigned = await categorizeMovements(deps, "u1", [mov("d", "debit")])
  assert.equal(assigned, 0)
  assert.equal(applied.length, 0)
})

test("categorizeMovements: si el usuario categoriza durante la carrera, la IA no sobrescribe", async () => {
  // Store con estado: null = sin categoría. El provider simula la carrera asignando la elección
  // del usuario MIENTRAS la IA "responde"; la escritura condicional debe respetarla.
  const store = new Map<string, string | null>([["d", null]])
  const provider: CategorizationProvider = {
    async categorize({ movements, categories }) {
      store.set("d", "eleccion-del-usuario")
      return Object.fromEntries(movements.map((m) => [m.id, categories[0].id]))
    },
  }
  const { deps } = makeDeps(provider, [cat("gasto1", "expense")])
  deps.transactions.setCategoryIfUncategorized = async (id, categoryId) => {
    if (store.get(id) !== null) return false // ya no está null → la IA no escribe
    store.set(id, categoryId)
    return true
  }
  const assigned = await categorizeMovements(deps, "u1", [mov("d", "debit")])
  assert.equal(assigned, 0)
  assert.equal(store.get("d"), "eleccion-del-usuario") // la elección manual se conserva
})

test("categorizeMovements: no re-categoriza los que ya tienen categoría", async () => {
  let called = false
  const provider: CategorizationProvider = {
    async categorize({ movements }) {
      called = true
      return Object.fromEntries(movements.map((m) => [m.id, "gasto1"]))
    },
  }
  const { deps, applied } = makeDeps(provider, [cat("gasto1", "expense")])
  const already = { ...mov("d", "debit"), categoryId: "gasto1" }
  const assigned = await categorizeMovements(deps, "u1", [already])
  assert.equal(assigned, 0)
  assert.equal(applied.length, 0)
  assert.equal(called, false) // ni siquiera llama al provider si no hay pendientes
})
