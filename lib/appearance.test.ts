import { test } from "node:test"
import assert from "node:assert/strict"
import {
  appearanceScript,
  beginSave,
  createSaveTracker,
  endSave,
  legacyPatch,
  markMigrated,
} from "./appearance.ts"
import { USER_SETTINGS_DEFAULTS } from "./schemas/user-settings.ts"

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage

// Corre el script del layout contra un <html> de mentira y devuelve cómo quedó.
function runScript(
  server: typeof USER_SETTINGS_DEFAULTS,
  stored: boolean,
  prefersDark = false
) {
  const classes = new Set<string>()
  const html = {
    classList: {
      add: (c: string) => classes.add(c),
      remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
    },
    style: {} as { colorScheme?: string },
    dataset: {} as { glass?: string; theme?: string },
  }
  new Function(
    "document",
    "localStorage",
    "matchMedia",
    appearanceScript(server, stored)
  )({ documentElement: html }, globalThis.localStorage, () => ({
    matches: prefersDark,
  }))
  assert.equal(
    html.dataset.theme,
    [...classes].join(),
    "Glisse and app theme match before hydration"
  )
  return {
    theme: [...classes].join(),
    glass: html.dataset.glass,
    stored: store.get("theme"),
  }
}

test("Si el usuario nunca guardó nada, sube una vez lo que el dispositivo tenía distinto.", () => {
  store.clear()
  store.set("theme", "light")
  store.set("glass-level", "4")
  assert.deepEqual(legacyPatch(USER_SETTINGS_DEFAULTS, false), {
    theme: "light",
    glassLevel: 4,
  })
  // La carga que migra ya pinta lo local, sin salto.
  assert.deepEqual(runScript(USER_SETTINGS_DEFAULTS, false), {
    theme: "light",
    glass: "4",
    stored: "light",
  })
  markMigrated()
  assert.equal(store.has("glass-level"), false)
  assert.equal(legacyPatch(USER_SETTINGS_DEFAULTS, false), null)
  // Migrado, manda la base aunque next-themes haya dejado otro tema guardado.
  assert.deepEqual(runScript(USER_SETTINGS_DEFAULTS, false), {
    theme: "dark",
    glass: undefined,
    stored: "dark",
  })
})

test("Si guardó algo (aunque sean los defaults), no se migra y se pinta lo de la base.", () => {
  store.clear()
  store.set("theme", "light")
  store.set("glass-level", "0")
  assert.equal(legacyPatch(USER_SETTINGS_DEFAULTS, true), null)
  assert.deepEqual(runScript(USER_SETTINGS_DEFAULTS, true), {
    theme: "dark",
    glass: undefined,
    stored: "dark",
  })
  const server = { glassLevel: 3, theme: "dark" as const }
  assert.equal(legacyPatch(server, true), null)
  assert.deepEqual(runScript(server, true), {
    theme: "dark",
    glass: "3",
    stored: "dark",
  })
})

test("Lo local igual a la base o inválido no se sube.", () => {
  store.clear()
  store.set("theme", "dark")
  store.set("glass-level", "9")
  assert.equal(legacyPatch(USER_SETTINGS_DEFAULTS, false), null)
})

test("El script escapa lo que podría cerrar la etiqueta <script>.", () => {
  const script = appearanceScript(
    { glassLevel: 2, theme: "</script><b>\u2028" as "dark" },
    true
  )
  assert.equal(script.includes("</script>"), false)
  assert.equal(script.includes("\u2028"), false)
})

const base = { glassLevel: 2, theme: "dark" as const }

test("Con varios PATCH en vuelo, solo revierte el que sigue siendo el último pedido.", () => {
  let t = createSaveTracker(base)
  const a = beginSave(t, { glassLevel: 3 })
  t = a.tracker
  const b = beginSave(t, { glassLevel: 4 })
  t = b.tracker
  // El viejo falla después de que salió el nuevo: la pantalla ya muestra el nuevo.
  let r = endSave(t, a.ticket, null)
  assert.deepEqual(r.revert, {})
  t = r.tracker
  // El nuevo falla: vuelve a lo último confirmado.
  r = endSave(t, b.ticket, null)
  assert.deepEqual(r.revert, { glassLevel: 2 })
  assert.equal(r.tracker.requested.glassLevel, 2)
})

test("Campos distintos en desorden: cada respuesta confirma o revierte solo su campo.", () => {
  let t = createSaveTracker(base)
  const theme = beginSave(t, { theme: "light" })
  t = theme.tracker
  const glass = beginSave(t, { glassLevel: 0 })
  t = glass.tracker
  // Llega primero el vidrio (la base ya tiene el tema nuevo también) y confirma solo el vidrio.
  let r = endSave(t, glass.ticket, { glassLevel: 0, theme: "light" })
  assert.deepEqual(r.tracker.saved, { glassLevel: 0, theme: "dark" })
  t = r.tracker
  // El tema falla: revierte el tema, no el vidrio.
  r = endSave(t, theme.ticket, null)
  assert.deepEqual(r.revert, { theme: "dark" })
  assert.deepEqual(r.tracker.saved, { glassLevel: 0, theme: "dark" })
})

test("Una respuesta vieja que llega tarde no pisa lo confirmado más nuevo.", () => {
  let t = createSaveTracker(base)
  const a = beginSave(t, { glassLevel: 4 })
  t = a.tracker
  const b = beginSave(t, { glassLevel: 2 })
  t = b.tracker
  t = endSave(t, b.ticket, { glassLevel: 2, theme: "dark" }).tracker
  t = endSave(t, a.ticket, { glassLevel: 4, theme: "dark" }).tracker
  assert.equal(t.saved.glassLevel, 2)
})

test("2→4→2 rápido: lo último pedido es 2 aunque la base aún tenga 2 confirmado.", () => {
  let t = createSaveTracker(base)
  t = beginSave(t, { glassLevel: 4 }).tracker
  // saveGlass compara contra requested: 2 ≠ 4, así que el segundo 2 sí se manda.
  assert.equal(t.requested.glassLevel, 4)
  assert.equal(t.saved.glassLevel, 2)
})

test("El script escapado sigue entregando el valor original.", () => {
  store.clear()
  const theme = "</script><b>  " as "dark"
  assert.equal(runScript({ glassLevel: 2, theme }, true).stored, theme)
})

test("Si el pedido nuevo falla antes que el viejo, la pantalla sigue a lo que quedó en la base.", () => {
  let t = createSaveTracker(base)
  const a = beginSave(t, { glassLevel: 3 })
  t = a.tracker
  const b = beginSave(t, { glassLevel: 4 })
  t = b.tracker
  // B falla primero: revierte a lo confirmado (2).
  let r = endSave(t, b.ticket, null)
  assert.deepEqual(r.revert, { glassLevel: 2 })
  t = r.tracker
  // A confirma 3: eso es lo que quedó en la base, así que se repinta y requested lo sigue.
  r = endSave(t, a.ticket, { glassLevel: 3, theme: "dark" })
  assert.deepEqual(r.revert, { glassLevel: 3 })
  assert.equal(r.tracker.saved.glassLevel, 3)
  assert.equal(r.tracker.requested.glassLevel, 3)
})

test("System theme initializes Glisse in either OS appearance", () => {
  store.clear()
  const settings = { ...USER_SETTINGS_DEFAULTS, theme: "system" as const }
  assert.equal(runScript(settings, true, true).theme, "dark")
  assert.equal(runScript(settings, true, false).theme, "light")
})
