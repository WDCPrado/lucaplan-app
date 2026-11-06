// Bordes del onboarding (WDC-181, ronda de correcciones): con el onboarding terminado ya no se
// propone ni se reemplaza el set, y nombres que solo difieren en mayúsculas no se adivinan.
// Corre con: node --test arch/v1/application/onboarding-use-cases/onboarding-guards.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { proposeCategories } from "./propose-categories-use-case.ts"
import { applyOnboardingCategories } from "./apply-onboarding-categories-use-case.ts"
import { domainErrorStatus } from "../domain-error-status.ts"
import type { Category, CategoryInput } from "../../domain/finance/finance.domain.ts"

const completedAt = (at: Date | null) => ({ completedAt: async () => at })

const cat = (id: string, name: string): Category => ({
  id,
  userId: "u1",
  name,
  type: "expense",
  icon: "Utensils",
  color: "#ef4444",
  description: null,
  paceEnabled: true,
})

function store(initial: Category[]) {
  const rows = initial.map((c) => ({ ...c }))
  const writes: string[] = []
  return {
    rows,
    writes,
    repo: {
      async listByUser() {
        return rows
      },
      async upsert(input: CategoryInput) {
        writes.push(`upsert:${input.id ?? "new"}:${input.name}`)
        const next = { paceEnabled: true, ...input, id: input.id ?? "new" } as Category
        const i = rows.findIndex((c) => c.id === next.id)
        if (i >= 0) rows[i] = next
        else rows.push(next)
        return next
      },
      async delete(id: string) {
        writes.push(`delete:${id}`)
        rows.splice(rows.findIndex((c) => c.id === id), 1)
      },
    },
  }
}

const usage = { async usedCategoryIds() { return new Set<string>() } }
const item = (name: string) => ({ name, type: "expense", icon: "Utensils", color: "#ef4444", description: "Rappi" })

test("proponer con el onboarding terminado responde 409 sin llamar a la IA", async () => {
  let calls = 0
  const proposer = { async propose() { calls++; return null } }
  await assert.rejects(
    proposeCategories(
      { proposer, onboarding: completedAt(new Date()) },
      { description: "Voy al gimnasio y compro en el Líder" },
      "u1"
    ),
    (e) => domainErrorStatus(e) === 409
  )
  assert.equal(calls, 0)
  // Sin terminar, propone como siempre.
  const out = await proposeCategories(
    { proposer: null, onboarding: completedAt(null) },
    { description: "Voy al gimnasio y compro en el Líder" },
    "u1"
  )
  assert.equal(out.source, "default")
})

test("guardar el set con el onboarding terminado responde 409 sin escribir nada", async () => {
  const s = store([cat("c1", "Viajes")])
  await assert.rejects(
    applyOnboardingCategories(
      { categories: s.repo, usage, onboarding: completedAt(new Date()) },
      "u1",
      { categories: [item("Comida")] }
    ),
    (e) => domainErrorStatus(e) === 409
  )
  assert.deepEqual(s.writes, [])
})

test("dos categorías que solo difieren en mayúsculas: se actualiza la de nombre exacto; si ninguna lo es, 422 sin escribir", async () => {
  const s = store([cat("c1", "Comida"), cat("c2", "comida")])
  await applyOnboardingCategories({ categories: s.repo, usage, onboarding: completedAt(null) }, "u1", {
    categories: [item("comida")],
  })
  assert.deepEqual(s.writes, ["upsert:c2:comida"])

  const amb = store([cat("c1", "Comida"), cat("c2", "comida")])
  await assert.rejects(
    applyOnboardingCategories({ categories: amb.repo, usage, onboarding: completedAt(null) }, "u1", {
      categories: [item("COMIDA"), item("Viajes")],
    }),
    (e) => domainErrorStatus(e) === 422 && /COMIDA/.test((e as Error).message)
  )
  assert.deepEqual(amb.writes, [])
})
