// Proponer categorías con IA sobre el set precreado (WDC-181). No escribe: sus deps no traen repos.
// Corre con: node --test arch/v1/application/onboarding-use-cases/propose-categories.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { ZodError } from "zod"
import { proposeCategories } from "./propose-categories-use-case.ts"
import { DEFAULT_CATEGORIES } from "../finance-use-cases/seed-default-categories-use-case.ts"
import {
  CATEGORY_COLOR_VALUES,
  CATEGORY_ICON_NAMES,
  type CategoryProposer,
} from "../../domain/onboarding/onboarding.domain.ts"
import { domainErrorStatus } from "../domain-error-status.ts"
import { proposeCategoriesOutput } from "../../../../lib/onboarding-schemas.ts"

const DESCRIPCION = "Vivo en Ñuñoa, voy al gimnasio, compro en el Líder y tengo un perro."

// La entrada inválida responde 400: el use-case valida con el esquema del contrato (ZodError, que la
// ruta traduce a 400) o lanza un error de dominio que domainErrorStatus marca como 400.
const isBadRequest = (e: unknown) => e instanceof ZodError || domainErrorStatus(e) === 400

function proposer(answer: () => Promise<unknown>) {
  const calls: { description: string; base: readonly { name: string }[] }[] = []
  const p: CategoryProposer = {
    async propose(input) {
      calls.push(input)
      return answer()
    },
  }
  return { p, calls }
}

const fromDefault = () =>
  DEFAULT_CATEGORIES.map((c) => ({ ...c, change: "kept", reason: null }))

test("con IA: propone el set precreado con lo que conservó, editó y agregó, cada cambio con su razón", async () => {
  const ai = [
    { ...DEFAULT_CATEGORIES[0], change: "kept", reason: null },
    {
      ...DEFAULT_CATEGORIES[1],
      description: "Líder de Ñuñoa, Jumbo y ferias de barrio.",
      change: "edited",
      reason: "Mencionaste que compras en el Líder",
    },
    {
      name: "Gimnasio",
      type: "expense",
      icon: "Dumbbell",
      color: "#14b8a6",
      description: "Smart Fit, Pacific, Energy.",
      change: "added",
      reason: "Mencionaste que vas al gimnasio",
    },
    {
      name: "Mascotas",
      type: "expense",
      icon: "PawPrint",
      color: "#64748b",
      description: "Veterinaria, Club de Perros y Gatos, alimento.",
      change: "added",
      reason: "Tienes un perro",
    },
  ]
  const { p, calls } = proposer(async () => ({ categories: ai }))
  const out = await proposeCategories({ proposer: p }, { description: `  ${DESCRIPCION}  ` })
  assert.equal(out.source, "ai")
  assert.deepEqual(out, proposeCategoriesOutput.parse({ source: "ai", categories: ai }))
  // La IA recibe lo que escribió la persona (sin espacios de más) y el set precreado como base.
  assert.equal(calls.length, 1)
  assert.equal(calls[0].description, DESCRIPCION)
  assert.deepEqual(
    calls[0].base.map((c) => c.name),
    DEFAULT_CATEGORIES.map((c) => c.name)
  )
})

test("sin API key, si OpenAI falla o si devuelve basura: propone el set precreado tal cual (source default)", async () => {
  const expected = { source: "default", categories: fromDefault() }
  // Sin API key no hay proposer: no se llama a nadie.
  assert.deepEqual(await proposeCategories({ proposer: null }, { description: DESCRIPCION }), expected)
  for (const answer of [
    async () => {
      throw new Error("OpenAI 500")
    },
    async () => "no es json",
    async () => null,
    async () => ({ categories: [] }),
    async () => ({ categories: [{ name: "", type: "otro" }] }),
    async () => ({ categorias: fromDefault() }),
  ]) {
    const { p, calls } = proposer(answer)
    assert.deepEqual(await proposeCategories({ proposer: p }, { description: DESCRIPCION }), expected)
    assert.equal(calls.length, 1)
  }
})

test("un icono o color fuera del catálogo que devuelva la IA se reemplaza por uno válido, sin romper la propuesta", async () => {
  const { p } = proposer(async () => ({
    categories: [
      { name: "Gimnasio", type: "expense", icon: "Unicorn", color: "#123456", description: null, change: "added", reason: "Vas al gimnasio" },
      { name: "Mascotas", type: "expense", icon: "🐶", color: "rojo", description: null, change: "added", reason: "Tienes un perro" },
      { name: "Sueldo", type: "income", icon: "Wallet", color: "#10b981", description: null, change: "kept", reason: null },
    ],
  }))
  const out = await proposeCategories({ proposer: p }, { description: DESCRIPCION })
  assert.equal(out.source, "ai")
  assert.deepEqual(out.categories.map((c) => c.name), ["Gimnasio", "Mascotas", "Sueldo"])
  for (const c of out.categories) {
    assert.ok(CATEGORY_ICON_NAMES.includes(c.icon), `${c.name}: ${c.icon}`)
    assert.ok(CATEGORY_COLOR_VALUES.includes(c.color), `${c.name}: ${c.color}`)
  }
  // Lo que ya era válido no se toca.
  assert.equal(out.categories[2].icon, "Wallet")
  assert.equal(out.categories[2].color, "#10b981")
  // El catálogo es el de la pantalla (components/finance/category-icons.tsx).
  assert.ok(CATEGORY_ICON_NAMES.includes("Dumbbell") && !CATEGORY_ICON_NAMES.includes("Unicorn"))
  assert.ok(DEFAULT_CATEGORIES.every((c) => CATEGORY_ICON_NAMES.includes(c.icon) && CATEGORY_COLOR_VALUES.includes(c.color)))
})

test("una descripción de menos de 10 caracteres o de más de 1500 se rechaza (400) sin llamar a la IA", async () => {
  const { p, calls } = proposer(async () => ({ categories: fromDefault() }))
  for (const description of ["123456789", "   12345678   ", "x".repeat(1501), ""]) {
    await assert.rejects(proposeCategories({ proposer: p }, { description }), isBadRequest, JSON.stringify(description.slice(0, 20)))
  }
  assert.equal(calls.length, 0)
  // Bordes que sí pasan: 10 caracteres justos y 1500 justos.
  for (const description of ["1234567890", "x".repeat(1500)]) {
    const out = await proposeCategories({ proposer: p }, { description })
    assert.equal(out.source, "ai")
  }
})
