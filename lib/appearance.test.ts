import { test } from "node:test"
import assert from "node:assert/strict"
import { appearanceScript, legacyPatch, markMigrated } from "./appearance.ts"
import { USER_SETTINGS_DEFAULTS } from "./schemas/user-settings.ts"

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage

// Corre el script del layout contra un <html> de mentira y devuelve cómo quedó.
function runScript(server: typeof USER_SETTINGS_DEFAULTS, prefersDark = false) {
  const classes = new Set<string>()
  const html = {
    classList: {
      add: (c: string) => classes.add(c),
      remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
    },
    style: {} as { colorScheme?: string },
    dataset: {} as { glass?: string },
  }
  new Function(
    "document",
    "localStorage",
    "matchMedia",
    appearanceScript(server)
  )({ documentElement: html }, globalThis.localStorage, () => ({
    matches: prefersDark,
  }))
  return {
    theme: [...classes].join(),
    glass: html.dataset.glass,
    stored: store.get("theme"),
  }
}

test("Con la base en los defaults, sube una vez lo que el dispositivo tenía distinto.", () => {
  store.clear()
  store.set("theme", "light")
  store.set("glass-level", "4")
  assert.deepEqual(legacyPatch(USER_SETTINGS_DEFAULTS), {
    theme: "light",
    glassLevel: 4,
  })
  // La carga que migra ya pinta lo local, sin salto.
  assert.deepEqual(runScript(USER_SETTINGS_DEFAULTS), {
    theme: "light",
    glass: "4",
    stored: "light",
  })
  markMigrated()
  assert.equal(store.has("glass-level"), false)
  assert.equal(legacyPatch(USER_SETTINGS_DEFAULTS), null)
  // Migrado, manda la base aunque next-themes haya dejado otro tema guardado.
  assert.deepEqual(runScript(USER_SETTINGS_DEFAULTS), {
    theme: "dark",
    glass: undefined,
    stored: "dark",
  })
})

test("Si la base ya tiene algo guardado, no se migra y se pinta lo de la base.", () => {
  store.clear()
  store.set("theme", "light")
  store.set("glass-level", "0")
  const server = { glassLevel: 3, theme: "dark" as const }
  assert.equal(legacyPatch(server), null)
  assert.deepEqual(runScript(server), {
    theme: "dark",
    glass: "3",
    stored: "dark",
  })
})

test("Lo local igual a la base o inválido no se sube.", () => {
  store.clear()
  store.set("theme", "dark")
  store.set("glass-level", "9")
  assert.equal(legacyPatch(USER_SETTINGS_DEFAULTS), null)
})
