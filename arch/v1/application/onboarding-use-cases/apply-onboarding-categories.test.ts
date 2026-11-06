// Guardar las categorías del onboarding (WDC-181): upsert por nombre y limpieza de lo no usado.
// Corre con: node --test arch/v1/application/onboarding-use-cases/apply-onboarding-categories.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { ZodError } from "zod"
import { applyOnboardingCategories } from "./apply-onboarding-categories-use-case.ts"
import type { CategoryUsage } from "../../domain/onboarding/onboarding.domain.ts"
import type {
  Category,
  CategoryInput,
  CategoryRepository,
} from "../../domain/finance/finance.domain.ts"
import { domainErrorStatus } from "../domain-error-status.ts"

const isBadRequest = (e: unknown) => e instanceof ZodError || domainErrorStatus(e) === 400

const cat = (id: string, userId: string, name: string, over: Partial<Category> = {}): Category => ({
  id,
  userId,
  name,
  type: "expense",
  icon: "ShoppingBag",
  color: "#6366f1",
  description: null,
  paceEnabled: true,
  ...over,
})

// Repo en memoria con el mismo contrato que el de Prisma: upsert con id actualiza, sin id crea.
function store(initial: Category[]) {
  const rows = initial.map((c) => ({ ...c }))
  let seq = 0
  const writes: string[] = []
  const repo: CategoryRepository = {
    async listByUser(userId) {
      return rows.filter((c) => c.userId === userId)
    },
    async findById(id) {
      return rows.find((c) => c.id === id) ?? null
    },
    async upsert(input: CategoryInput) {
      writes.push(`upsert:${input.id ?? "new"}:${input.name}`)
      const next = { paceEnabled: true, ...input, id: input.id ?? `new-${++seq}` } as Category
      const i = rows.findIndex((c) => c.id === next.id)
      if (i >= 0) rows[i] = { ...rows[i], ...next }
      else rows.push(next)
      return next
    },
    async createMany(inputs) {
      for (const input of inputs) await repo.upsert(input)
    },
    async delete(id) {
      writes.push(`delete:${id}`)
      rows.splice(rows.findIndex((c) => c.id === id), 1)
    },
    async listLimitsByUser() {
      return []
    },
    async setLimit(): Promise<never> {
      throw new Error("no usado")
    },
  }
  return { repo, rows, writes }
}

const usage = (used: string[]): CategoryUsage => ({
  async usedCategoryIds() {
    return new Set(used)
  },
})

const item = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  type: "expense",
  icon: "ShoppingCart",
  color: "#f97316",
  description: null,
  ...over,
})

test("guardar: actualiza por nombre (sin importar mayúsculas), crea las nuevas, quita las no enviadas sin uso y conserva las que tienen movimientos; otro usuario no se toca", async () => {
  const { repo, rows } = store([
    cat("c1", "u1", "Sueldo", { type: "income" }),
    cat("c2", "u1", "Supermercado"),
    cat("c3", "u1", "Gimnasio"), // no viene, pero tiene movimientos/presupuesto/recurrente → se conserva
    cat("c4", "u1", "Viajes"), // no viene y no se usa → se elimina
    cat("c9", "u2", "Viajes"), // de otra persona
  ])
  await applyOnboardingCategories(
    { categories: repo, usage: usage(["c3"]) },
    "u1",
    {
      categories: [
        item("Sueldo", { type: "income", icon: "Wallet", color: "#10b981" }),
        item("  supermercado ", { description: "Líder y ferias" }),
        item("Mascotas", { icon: "PawPrint", color: "#64748b" }),
      ],
    }
  )
  const mine = rows.filter((c) => c.userId === "u1")
  const byId = Object.fromEntries(mine.map((c) => [c.id, c]))
  // Mismo id: los movimientos siguen apuntando a la categoría editada.
  assert.equal(byId.c2.description, "Líder y ferias")
  assert.equal(byId.c2.icon, "ShoppingCart")
  assert.equal(byId.c1.icon, "Wallet")
  assert.ok(byId.c3, "Gimnasio se conserva porque se usa")
  assert.equal(byId.c4, undefined, "Viajes sin uso se elimina")
  const mascotas = mine.find((c) => c.name === "Mascotas")
  assert.ok(mascotas && !["c1", "c2", "c3", "c4"].includes(mascotas.id))
  assert.equal(mine.length, 4)
  assert.deepEqual(
    rows.filter((c) => c.userId === "u2"),
    [cat("c9", "u2", "Viajes")]
  )
})

test("guardar rechaza (400) nombres repetidos sin importar mayúsculas ni espacios, e iconos o colores fuera del catálogo, sin escribir nada", async () => {
  for (const categories of [
    [item("Supermercado"), item(" supermercado")],
    [item("Mascotas", { icon: "Unicorn" })],
    [item("Mascotas", { icon: "🐶" })],
    [item("Mascotas", { color: "#123456" })], // hex válido pero fuera de la paleta
    [],
  ]) {
    const { repo, writes } = store([cat("c1", "u1", "Viajes")])
    await assert.rejects(
      applyOnboardingCategories({ categories: repo, usage: usage([]) }, "u1", { categories }),
      isBadRequest,
      JSON.stringify(categories)
    )
    assert.deepEqual(writes, [], JSON.stringify(categories))
  }
  // Borde: 30 categorías pasan, 31 no.
  const many = (n: number) => Array.from({ length: n }, (_, i) => item(`Categoría ${i + 1}`))
  const ok = store([])
  await applyOnboardingCategories({ categories: ok.repo, usage: usage([]) }, "u1", { categories: many(30) })
  assert.equal(ok.rows.length, 30)
  const tooMany = store([])
  await assert.rejects(
    applyOnboardingCategories({ categories: tooMany.repo, usage: usage([]) }, "u1", { categories: many(31) }),
    isBadRequest
  )
  assert.deepEqual(tooMany.writes, [])
})
