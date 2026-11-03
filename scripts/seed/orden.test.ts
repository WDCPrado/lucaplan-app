// Corre con: node --test scripts/seed/orden.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { DEMO, desajustesDelSeed } from "./orden.ts"

test("seed: cada archivo de produccion/ y demo/ está declarado en las listas, y cada uno declarado existe", () => {
  assert.deepEqual(desajustesDelSeed(), [])
})

test("seed: un archivo o un área fuera de las listas, o uno declarado que falta, es un error", () => {
  const raiz = mkdtempSync(join(tmpdir(), "seed-orden-"))
  try {
    for (const [area, archivos] of DEMO) {
      mkdirSync(join(raiz, "demo", area), { recursive: true })
      for (const f of archivos) writeFileSync(join(raiz, "demo", area, f), "")
    }
    const url = pathToFileURL(`${raiz}/`)
    assert.deepEqual(desajustesDelSeed(url), [])
    writeFileSync(join(raiz, "demo", "2-casos", "nuevo.ts"), "")
    mkdirSync(join(raiz, "demo", "3-otro"))
    mkdirSync(join(raiz, "produccion"))
    writeFileSync(join(raiz, "produccion", "roles.ts"), "")
    rmSync(join(raiz, "demo", "1-base", "cuenta-demo.ts"))
    assert.deepEqual(desajustesDelSeed(url).sort(), [
      "demo/1-base: falta cuenta-demo.ts",
      "demo/2-casos: sobra nuevo.ts",
      "demo: sobra el área 3-otro",
      "produccion: sobra roles.ts",
    ])
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})
