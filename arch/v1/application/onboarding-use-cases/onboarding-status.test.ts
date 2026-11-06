// Estado y término del onboarding (WDC-181), más la migración que marca a los usuarios existentes.
// Corre con: node --test arch/v1/application/onboarding-use-cases/onboarding-status.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { completeOnboarding } from "./complete-onboarding-use-case.ts"
import { getOnboardingStatus } from "./get-onboarding-status-use-case.ts"
import type { OnboardingRepository } from "../../domain/onboarding/onboarding.domain.ts"

function repo(initial: Record<string, Date | null> = {}) {
  const completed = new Map(Object.entries(initial))
  const r: OnboardingRepository = {
    async completedAt(userId) {
      return completed.get(userId) ?? null
    },
    async markCompleted(userId, at) {
      completed.set(userId, at)
    },
  }
  return { r, completed }
}

const ENV = { OPENAI_API_KEY: "sk-test", OUTLOOK_CLIENT_ID: "id", OUTLOOK_CLIENT_SECRET: "secret" }

test("usuario nuevo: el onboarding no está terminado, y dice si hay IA y Outlook según la configuración del servidor", async () => {
  const { r } = repo()
  assert.deepEqual(await getOnboardingStatus({ onboarding: r, env: ENV }, "u1"), {
    completed: false,
    aiAvailable: true,
    outlookAvailable: true,
  })
  // Bordes: clave vacía no cuenta; Outlook necesita las dos variables.
  for (const [env, expected] of [
    [{}, { aiAvailable: false, outlookAvailable: false }],
    [{ OPENAI_API_KEY: "" }, { aiAvailable: false, outlookAvailable: false }],
    [{ OUTLOOK_CLIENT_ID: "id" }, { aiAvailable: false, outlookAvailable: false }],
    [{ OUTLOOK_CLIENT_SECRET: "secret" }, { aiAvailable: false, outlookAvailable: false }],
  ] as const) {
    const s = await getOnboardingStatus({ onboarding: r, env }, "u1")
    assert.deepEqual({ aiAvailable: s.aiAvailable, outlookAvailable: s.outlookAvailable }, expected, JSON.stringify(env))
  }
})

test("terminar u omitir el onboarding es idempotente: la segunda vez no cambia la fecha y no toca a otro usuario", async () => {
  const { r, completed } = repo({ u2: null })
  const first = await completeOnboarding({ onboarding: r, env: ENV }, "u1")
  assert.equal(first.completed, true)
  const at = completed.get("u1")
  assert.ok(at instanceof Date)
  await new Promise((done) => setTimeout(done, 5))
  const second = await completeOnboarding({ onboarding: r, env: ENV }, "u1")
  assert.deepEqual(second, first)
  assert.equal(completed.get("u1"), at)
  assert.equal(completed.get("u2"), null)
  assert.equal((await getOnboardingStatus({ onboarding: r, env: ENV }, "u1")).completed, true)
})

test("migración: los usuarios que ya existían quedan con el onboarding terminado; los nuevos parten sin terminar", () => {
  const root = join(import.meta.dirname, "../../../..")
  const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8")
  const user = schema.match(/model User \{[\s\S]*?\n\}/)?.[0] ?? ""
  // Nullable y sin default: una cuenta recién creada queda con completed=false.
  assert.match(user, /onboardingCompletedAt\s+DateTime\?(?![^\n]*@default)/)
  const dir = join(root, "prisma/migrations")
  const sql = readdirSync(dir)
    .map((d) => join(dir, d, "migration.sql"))
    .filter(existsSync)
    .map((f) => readFileSync(f, "utf8"))
    .find((s) => s.includes("onboardingCompletedAt"))
  assert.ok(sql, "falta la migración de onboardingCompletedAt")
  assert.match(sql!, /ALTER TABLE "user" ADD COLUMN\s+"onboardingCompletedAt" TIMESTAMP\(3\)(?!\s*NOT NULL)(?!\s*DEFAULT)/)
  assert.match(sql!, /UPDATE "user" SET "onboardingCompletedAt"\s*=/)
})
