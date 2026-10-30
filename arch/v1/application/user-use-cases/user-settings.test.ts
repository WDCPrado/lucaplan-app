// Preferencias por usuario con un repo in-memory inyectado.
import { test } from "node:test"
import assert from "node:assert/strict"
import type { UserSettingRepository } from "../../domain/user/user-settings.domain.ts"
import {
  getUserSettings,
  updateUserSettings,
} from "./user-settings-use-cases.ts"

// Filas por usuario: userId → (clave → valor), igual que la tabla user_setting.
function memoryRepo(seed: Record<string, Record<string, string>> = {}) {
  const rows = new Map(Object.entries(seed).map(([u, kv]) => [u, { ...kv }]))
  const repo: UserSettingRepository = {
    async list(userId) {
      return { ...rows.get(userId) }
    },
    async upsert(userId, values) {
      rows.set(userId, { ...rows.get(userId), ...values })
    },
  }
  return { deps: { userSettings: repo }, rows }
}

test("Sin nada guardado, devuelve los valores por defecto.", async () => {
  const { deps } = memoryRepo()
  assert.deepEqual(await getUserSettings(deps, "u1"), {
    glassLevel: 2,
    theme: "dark",
  })
})

test("Lee lo guardado del usuario y no lo de otro.", async () => {
  const { deps } = memoryRepo({
    u1: { glass_level: "4", theme: "dark" },
    u2: { theme: "light" },
  })
  assert.deepEqual(await getUserSettings(deps, "u1"), {
    glassLevel: 4,
    theme: "dark",
  })
  assert.deepEqual(await getUserSettings(deps, "u2"), {
    glassLevel: 2,
    theme: "light",
  })
})

test("Un valor inválido en la base cae a su default sin tocar los demás.", async () => {
  const { deps } = memoryRepo({ u1: { glass_level: "9", theme: "sepia" } })
  assert.deepEqual(await getUserSettings(deps, "u1"), {
    glassLevel: 2,
    theme: "dark",
  })
  const { deps: d2 } = memoryRepo({
    u1: { glass_level: "abc", theme: "light" },
  })
  assert.deepEqual(await getUserSettings(d2, "u1"), {
    glassLevel: 2,
    theme: "light",
  })
})

test("Un patch parcial guarda solo su clave y devuelve el estado completo.", async () => {
  const { deps, rows } = memoryRepo({ u1: { theme: "dark" } })
  const out = await updateUserSettings(deps, "u1", { glassLevel: 0 })
  assert.deepEqual(out, { glassLevel: 0, theme: "dark" })
  assert.deepEqual(rows.get("u1"), { theme: "dark", glass_level: "0" })
  assert.deepEqual(await updateUserSettings(deps, "u1", { theme: "light" }), {
    glassLevel: 0,
    theme: "light",
  })
})

test("Un patch inválido o vacío no escribe nada.", async () => {
  const { deps, rows } = memoryRepo()
  await assert.rejects(() => updateUserSettings(deps, "u1", { glassLevel: 5 }))
  await assert.rejects(() => updateUserSettings(deps, "u1", {}))
  assert.equal(rows.has("u1"), false)
})
