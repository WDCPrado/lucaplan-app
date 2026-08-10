// Siembra de categorías por defecto: set completo en cuenta nueva, idempotencia y atomicidad.
// Corre con: node --test arch/v1/application/finance-use-cases/seed-default-categories.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import type {
  Category,
  CategoryInput,
  CategoryRepository,
} from "../../domain/finance/finance.domain.ts"
import {
  DEFAULT_CATEGORIES,
  seedDefaultCategories,
} from "./seed-default-categories-use-case.ts"

// Repo fake: solo lo que toca el use-case. `calls` cuenta las llamadas a createMany para verificar
// que la siembra es UNA sentencia, no N inserts.
function fakeRepo(existing: Category[] = [], failOnCreate = false) {
  const saved: CategoryInput[] = []
  let calls = 0
  const repo = {
    async listByUser() {
      return existing
    },
    async createMany(inputs: CategoryInput[]) {
      calls++
      if (failOnCreate) throw new Error("db caída")
      saved.push(...inputs)
    },
  } as unknown as CategoryRepository
  return { repo, saved, calls: () => calls }
}

test("cuenta nueva: siembra el set completo en una sola llamada", async () => {
  const { repo, saved, calls } = fakeRepo()
  await seedDefaultCategories({ categories: repo }, "u1")
  assert.equal(saved.length, 10)
  assert.equal(calls(), 1)
  assert.ok(saved.every((c) => c.userId === "u1"))
})

test("el set trae una categoría de ingreso y el resto de gasto", async () => {
  const incomes = DEFAULT_CATEGORIES.filter((c) => c.type === "income")
  assert.equal(incomes.length, 1)
  assert.equal(DEFAULT_CATEGORIES.filter((c) => c.type === "expense").length, 9)
})

test("toda categoría trae descripción para la IA, y los nombres son únicos", () => {
  assert.ok(DEFAULT_CATEGORIES.every((c) => c.description.trim().length > 0))
  const names = DEFAULT_CATEGORIES.map((c) => c.name)
  assert.equal(new Set(names).size, names.length)
})

test("sin cajón genérico: nada de Otros/Varios", () => {
  const generic = /^(otros?|varios?|general|sin categor)/i
  assert.ok(!DEFAULT_CATEGORIES.some((c) => generic.test(c.name)))
})

test("usuario con categorías: no escribe nada", async () => {
  const existing = [
    {
      id: "c1",
      userId: "u1",
      name: "La mía",
      type: "expense",
      icon: null,
      color: null,
      description: null,
    } as Category,
  ]
  const { repo, saved, calls } = fakeRepo(existing)
  await seedDefaultCategories({ categories: repo }, "u1")
  assert.equal(saved.length, 0)
  assert.equal(calls(), 0)
})

test("si la inserción falla, no queda nada persistido", async () => {
  const { repo, saved } = fakeRepo([], true)
  await assert.rejects(seedDefaultCategories({ categories: repo }, "u1"))
  assert.equal(saved.length, 0)
})
