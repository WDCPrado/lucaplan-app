// WDC-183 · extraerCartola: qué se rechaza antes de mandar la cartola afuera, qué hace con una salida
// mala del lector y cómo recorta un corte futuro. Lector falso que cuenta llamadas.
import test from "node:test"
import assert from "node:assert/strict"
import { extraerCartola, STATEMENT_MAX_BYTES } from "./extract-statement.ts"
import { StatementReadError } from "../../domain/finance/bank-reconciliation.domain.ts"
import { NotOwnerError } from "../../domain/finance/finance.domain.ts"

const NOW = new Date("2026-11-10T15:00:00Z") // 12:00 en Santiago
const doc = (snapshotAt: string) => ({
  snapshotAt,
  source: "Cartola corriente",
  buckets: [{ kind: "cash", currency: "CLP", limit: 0, used: 0, available: 1000 }],
  rows: [],
})

function setup(output: unknown = doc("2026-11-09T23:59:00-03:00")) {
  const calls: { accountType: string; buckets: unknown }[] = []
  const deps = {
    accounts: {
      findById: async (id: string) =>
        (id === "mia"
          ? { id, userId: "u1", accountType: "checking" }
          : { id, userId: "otro", accountType: "checking" }) as never,
    },
    balanceBuckets: {
      listByAccount: async () => [{ kind: "cash", currency: "CLP" }] as never,
    },
    statementReader: {
      read: async (_f: unknown, ctx: { accountType: string; buckets: unknown }) => {
        calls.push(ctx)
        if (output instanceof Error) throw output
        return output
      },
    },
  }
  return { deps, calls }
}
const file = (name: string, bytes = 10) => ({ name, type: "", data: new Uint8Array(bytes) })

test("cuenta ajena: se rechaza sin llamar al lector", async () => {
  const { deps, calls } = setup()
  await assert.rejects(extraerCartola(deps, "u1", "ajena", file("c.pdf"), NOW), NotOwnerError)
  assert.equal(calls.length, 0)
})

test("extensión no permitida, archivo vacío o de más de 10 MB: se rechazan sin llamar al lector", async () => {
  const { deps, calls } = setup()
  for (const f of [file("c.docx"), file("c.pdf", 0), file("c.pdf", STATEMENT_MAX_BYTES + 1)])
    await assert.rejects(extraerCartola(deps, "u1", "mia", f, NOW), StatementReadError)
  assert.equal(calls.length, 0)
})

test("salida inválida o lector caído → «No se pudo leer la cartola»", async () => {
  for (const output of [{ nada: true }, new Error("OpenAI 500")]) {
    const { deps, calls } = setup(output)
    await assert.rejects(extraerCartola(deps, "u1", "mia", file("c.csv"), NOW), {
      name: "StatementReadError",
      message: "No se pudo leer la cartola",
    })
    assert.equal(calls.length, 1)
  }
})

test("el lector recibe los cupos de la cuenta; un corte futuro se recorta a ahora y uno pasado queda igual", async () => {
  const future = setup(doc("2026-11-10T23:59:00-03:00"))
  const read = await extraerCartola(future.deps, "u1", "mia", file("c.pdf"), NOW)
  assert.equal(read.snapshotAt, NOW.toISOString())
  assert.deepEqual(future.calls[0].buckets, [{ kind: "cash", currency: "CLP" }])

  const past = setup()
  const kept = await extraerCartola(past.deps, "u1", "mia", file("c.pdf"), NOW)
  assert.equal(kept.snapshotAt, "2026-11-09T23:59:00-03:00")
})

test("una lectura a la vez por usuario: la segunda mientras corre la primera → 409 (LockBusyError)", async () => {
  const { deps } = setup()
  let release!: () => void
  const slow = {
    ...deps,
    statementReader: {
      read: () =>
        new Promise((r) => {
          release = () => r(doc("2026-11-09T23:59:00-03:00"))
        }),
    },
  }
  const first = extraerCartola(slow, "u1", "mia", file("c.pdf"), NOW)
  await new Promise((r) => setImmediate(r))
  await assert.rejects(extraerCartola(slow, "u1", "mia", file("c.pdf"), NOW), {
    name: "LockBusyError",
  })
  release()
  await first
})
