// Aprendizaje de categorización: normalización, selección exacta/parecida con tope, inyección al
// provider, registro best-effort al categorizar a mano y follow-up (nota + propagación).
// Corre con: node --test arch/v1/application/finance-use-cases/categorization-learning.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type {
  Category,
  Direction,
  Transaction,
} from "../../domain/finance/finance.domain.ts"
import type {
  CategorizationProvider,
  CategorizationCorrectionHint,
} from "../../domain/finance/categorization.port.ts"
import {
  normalizeMovementText,
  selectCorrectionsForBatch,
  type CategorizationCorrection,
  type CorrectionRepository,
} from "../../domain/finance/categorization-learning.domain.ts"
import { categorizeMovements } from "./categorize-movements-use-case.ts"
import { categorizeTransaction } from "./categorize-transaction-use-case.ts"
import { annotateCorrection } from "./annotate-correction-use-case.ts"

// --- helpers ---

const cat = (id: string, type: "income" | "expense"): Category => ({
  id,
  userId: "u1",
  name: id,
  type,
  icon: null,
  color: null,
  description: null,
})

const mov = (
  id: string,
  direction: Direction,
  description = `mov ${id}`
): Transaction => ({
  id,
  userId: "u1",
  accountId: "a1",
  categoryId: null,
  date: new Date("2026-07-01"),
  description,
  amount: Money.of(1000, "CLP"),
  direction,
  status: "confirmed",
  isInternal: false,
  externalId: `mov_${id}`,
})

const correction = (
  normalizedText: string,
  categoryId: string,
  note: string | null = null
): CategorizationCorrection => ({
  id: `corr-${normalizedText}`,
  userId: "u1",
  direction: "debit",
  normalizedText,
  sampleText: normalizedText,
  categoryId,
  note,
})

// Repos mínimos para los use-cases (solo lo que cada test usa).
function fakeTransactions(byId: Record<string, Transaction>) {
  return {
    async listByUserPeriod() {
      return []
    },
    async listByCategoryPeriod() {
      return []
    },
    async searchByUser() {
      return []
    },
    async findById(id: string) {
      return byId[id] ?? null
    },
    async create(): Promise<Transaction> {
      throw new Error("no usado")
    },
    async update(): Promise<Transaction> {
      throw new Error("no usado")
    },
    async setCategory(id: string, categoryId: string | null) {
      return { ...byId[id], categoryId }
    },
    async setCategoryIfUncategorized() {
      return true
    },
    async delete() {},
  }
}

function fakeCategories(cats: Category[]) {
  return {
    async listByUser() {
      return cats
    },
    async findById(id: string) {
      return cats.find((c) => c.id === id) ?? null
    },
    async upsert(): Promise<Category> {
      throw new Error("no usado")
    },
    async listLimitsByUser() {
      return []
    },
    async setLimit(): Promise<never> {
      throw new Error("no usado")
    },
  }
}

function fakeCorrections(overrides: Partial<CorrectionRepository> = {}) {
  const calls = {
    upserts: [] as unknown[],
    notes: [] as unknown[],
    applies: [] as unknown[],
  }
  const repo: CorrectionRepository = {
    async upsertByText(input) {
      calls.upserts.push(input)
      return {
        id: "c1",
        note: null,
        ...input,
        note2: undefined,
        sampleText: input.sampleText,
      } as unknown as CategorizationCorrection
    },
    async listByUserDirection() {
      return []
    },
    async setNote(userId, direction, normalizedText, note) {
      calls.notes.push({ normalizedText, note })
    },
    async countSameText() {
      return 3
    },
    async applyCategoryToSameText(
      userId,
      direction,
      normalizedText,
      categoryId
    ) {
      calls.applies.push({ normalizedText, categoryId })
      return 3
    },
    ...overrides,
  }
  return { repo, calls }
}

// --- normalización ---

test("normalizeMovementText: dos operaciones del mismo comercio normalizan igual", () => {
  const a = normalizeMovementText("Compra Café Altura 12/07 N°123456 $15.990")
  const b = normalizeMovementText(
    "compra cafe altura 03/06/2026 N°998877 $4.500"
  )
  assert.equal(a, b)
  assert.equal(a, "COMPRA CAFE ALTURA N° $")
})

test("normalizeMovementText: conserva lo distintivo del comercio", () => {
  assert.equal(
    normalizeMovementText("Pago:payu *uber eats"),
    "PAGO:PAYU *UBER EATS"
  )
})

// --- selección exacta/parecida ---

test("selectCorrectionsForBatch: exacta siempre entra y va primero; la no relacionada queda fuera", () => {
  const exact = correction("PAGO:PAYU *UBER EATS", "comida")
  const similar = correction("PAYU *UBEREATS SANTIAGO CENTRO", "comida") // compartirá tokens
  const unrelated = correction("COPEC ESTACION SERVICIO", "transporte")
  const out = selectCorrectionsForBatch(
    ["Pago:payu *uber eats 4455"],
    [unrelated, similar, exact]
  )
  assert.equal(out[0], exact)
  assert.ok(!out.includes(unrelated))
})

test("selectCorrectionsForBatch: respeta el tope con las exactas primero", () => {
  const exacts = [
    correction("JUMBO COSTANERA", "super"),
    correction("LIDER MALL", "super"),
  ]
  const fillers = Array.from({ length: 40 }, (_, i) =>
    correction(`OTRO COMERCIO ${String.fromCharCode(65 + i)}X`, "otros")
  )
  const out = selectCorrectionsForBatch(
    ["Jumbo Costanera", "Lider Mall"],
    [...fillers, ...exacts],
    2
  )
  assert.deepEqual(out, [exacts[0], exacts[1]])
})

// --- inyección en categorizeMovements ---

test("categorizeMovements: inyecta al provider solo correcciones del lado y de categorías permitidas", async () => {
  let received: CategorizationCorrectionHint[] | undefined
  const provider: CategorizationProvider = {
    async categorize({ movements, corrections }) {
      received = corrections
      return Object.fromEntries(movements.map((m) => [m.id, null]))
    },
  }
  const listed = [
    {
      ...correction("JUMBO COSTANERA", "gasto1", "supermercado de la semana"),
      sampleText: "Jumbo Costanera 12/07",
    },
    correction("SUELDO EMPRESA", "ingreso1"), // categoría del otro lado: se filtra
  ]
  const deps = {
    transactions: fakeTransactions({}),
    categories: fakeCategories([
      cat("gasto1", "expense"),
      cat("ingreso1", "income"),
    ]),
    categorization: provider,
    corrections: fakeCorrections({
      async listByUserDirection() {
        return listed
      },
    }).repo,
  }
  await categorizeMovements(deps, "u1", [
    mov("d", "debit", "Jumbo Costanera 03/06"),
  ])
  assert.deepEqual(received, [
    {
      text: "Jumbo Costanera 12/07",
      note: "supermercado de la semana",
      categoryId: "gasto1",
    },
  ])
})

test("categorizeMovements: retrieval caído degrada a categorizar sin correcciones", async () => {
  let received: CategorizationCorrectionHint[] | undefined = [
    { text: "x", note: null, categoryId: "y" },
  ]
  const provider: CategorizationProvider = {
    async categorize({ movements, corrections }) {
      received = corrections
      return Object.fromEntries(movements.map((m) => [m.id, "gasto1"]))
    },
  }
  const deps = {
    transactions: fakeTransactions({}),
    categories: fakeCategories([cat("gasto1", "expense")]),
    categorization: provider,
    corrections: fakeCorrections({
      async listByUserDirection(): Promise<CategorizationCorrection[]> {
        throw new Error("db caída")
      },
    }).repo,
  }
  const assigned = await categorizeMovements(deps, "u1", [mov("d", "debit")])
  assert.equal(assigned, 1) // la pasada sigue
  assert.deepEqual(received, [])
})

// --- registro al categorizar a mano ---

test("categorizeTransaction: registra la corrección con texto normalizado y devuelve sameTextCount", async () => {
  const tx = mov("t1", "debit", "Jumbo Costanera 12/07 N°123456")
  const { repo, calls } = fakeCorrections()
  const out = await categorizeTransaction(
    {
      transactions: fakeTransactions({ t1: tx }),
      categories: fakeCategories([cat("gasto1", "expense")]),
      corrections: repo,
    },
    "u1",
    "t1",
    "gasto1"
  )
  assert.equal(out.transaction.categoryId, "gasto1")
  assert.equal(out.sameTextCount, 3)
  assert.equal(calls.upserts.length, 1)
  const up = calls.upserts[0] as {
    normalizedText: string
    sampleText: string
    categoryId: string
  }
  assert.equal(up.normalizedText, normalizeMovementText(tx.description))
  assert.equal(up.sampleText, tx.description)
  assert.equal(up.categoryId, "gasto1")
})

test("categorizeTransaction: un registro que falla no bloquea la asignación (best-effort)", async () => {
  const tx = mov("t1", "debit")
  const { repo } = fakeCorrections({
    async upsertByText(): Promise<CategorizationCorrection> {
      throw new Error("db caída")
    },
  })
  const out = await categorizeTransaction(
    {
      transactions: fakeTransactions({ t1: tx }),
      categories: fakeCategories([cat("gasto1", "expense")]),
      corrections: repo,
    },
    "u1",
    "t1",
    "gasto1"
  )
  assert.equal(out.transaction.categoryId, "gasto1")
  assert.equal(out.sameTextCount, 0)
})

test("categorizeTransaction: asignar null no registra corrección", async () => {
  const tx = { ...mov("t1", "debit"), categoryId: "gasto1" }
  const { repo, calls } = fakeCorrections()
  const out = await categorizeTransaction(
    {
      transactions: fakeTransactions({ t1: tx }),
      categories: fakeCategories([cat("gasto1", "expense")]),
      corrections: repo,
    },
    "u1",
    "t1",
    null
  )
  assert.equal(out.transaction.categoryId, null)
  assert.equal(calls.upserts.length, 0)
})

// --- follow-up: nota + propagación ---

test("annotateCorrection: guarda la nota y propaga a los mismos textos", async () => {
  const tx = {
    ...mov("t1", "debit", "Jumbo Costanera 12/07"),
    categoryId: "gasto1",
  }
  const { repo, calls } = fakeCorrections()
  const out = await annotateCorrection(
    { transactions: fakeTransactions({ t1: tx }), corrections: repo },
    "u1",
    "t1",
    { note: "supermercado de la semana", applyToSameText: true }
  )
  assert.equal(out.applied, 3)
  assert.deepEqual(calls.notes, [
    {
      normalizedText: normalizeMovementText(tx.description),
      note: "supermercado de la semana",
    },
  ])
  assert.equal(calls.applies.length, 1)
})

test("annotateCorrection: sin categoría no anota ni propaga", async () => {
  const tx = mov("t1", "debit") // categoryId null
  const { repo, calls } = fakeCorrections()
  const out = await annotateCorrection(
    { transactions: fakeTransactions({ t1: tx }), corrections: repo },
    "u1",
    "t1",
    { note: "algo", applyToSameText: true }
  )
  assert.equal(out.applied, 0)
  assert.equal(calls.notes.length, 0)
  assert.equal(calls.applies.length, 0)
})
