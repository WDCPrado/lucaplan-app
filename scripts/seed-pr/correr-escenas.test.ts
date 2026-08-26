// El recorrido de escenas, probado SIN base de datos: `sembrar` y `cargar` son falsos. Lo que se
// verifica acá es lo que el seed promete y no se ve corriéndolo una vez en verde — que una escena
// rota no arrastre a las demás, que una ya sembrada no se rehaga y que el descubrimiento no tumbe
// el arranque del contenedor.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"

import {
  archivosDeEscena,
  correrEscenas,
  type Sembrador,
} from "./correr-escenas.ts"
import type { Escena, EscenaContext } from "./sembrar-usuario.ts"

// El contexto real trae un PrismaClient; a las escenas falsas de este test les da lo mismo.
const CTX = {} as EscenaContext

// Las funciones registran su avance por consola: se silencia para no ensuciar la salida del test,
// y de paso se guarda lo emitido para poder afirmar sobre los avisos.
let salida: string[] = []
const original = { log: console.log, warn: console.warn, error: console.error }
beforeEach(() => {
  salida = []
  const capturar =
    (nivel: string) =>
    (...args: unknown[]) =>
      void salida.push(`${nivel} ${args.map(String).join(" ")}`)
  console.log = capturar("log")
  console.warn = capturar("warn")
  console.error = capturar("error")
})
afterEach(() => Object.assign(console, original))

// Escena falsa: por defecto siembra bien y anota su paso en `corridas`.
const corridas: string[] = []
function escena(correo: string, seed?: () => Promise<void>): Escena {
  return {
    correo,
    titulo: `escena ${correo}`,
    seed:
      seed ??
      (async () => {
        corridas.push(correo)
      }),
  }
}

const sembradorOk: Sembrador = async () => CTX
const correr = (
  escenas: Record<string, Escena | Error>,
  sembrar: Sembrador = sembradorOk
) =>
  correrEscenas({
    archivos: Object.keys(escenas),
    cargar: async (archivo) => {
      const e = escenas[archivo]
      if (e instanceof Error) throw e
      return e
    },
    sembrar,
    password: "clave1234",
    dominio: "@lucaplan.cl",
  })

describe("correrEscenas", () => {
  it("una escena que lanza no cancela a las siguientes", async () => {
    corridas.length = 0
    const resumen = await correr({
      "a.ts": escena("a@lucaplan.cl"),
      "b.ts": escena("b@lucaplan.cl", async () => {
        throw new Error("esquema cambiado debajo")
      }),
      "c.ts": escena("c@lucaplan.cl"),
    })

    // La de después de la rota igual corrió: eso es lo único que impide que una escena vieja
    // tumbe el entorno entero.
    assert.deepEqual(corridas, ["a@lucaplan.cl", "c@lucaplan.cl"])
    assert.deepEqual(resumen, { sembradas: 2, omitidas: 0, fallidas: 1 })
    assert.ok(salida.some((l) => l.includes("la escena b.ts falló")))
  })

  it("un import que revienta se cuenta como fallo, no tumba el recorrido", async () => {
    corridas.length = 0
    const resumen = await correr({
      "a.ts": new Error("import roto"),
      "b.ts": escena("b@lucaplan.cl"),
    })

    assert.deepEqual(corridas, ["b@lucaplan.cl"])
    assert.deepEqual(resumen, { sembradas: 1, omitidas: 0, fallidas: 1 })
  })

  it("un usuario que ya estaba sembrado se salta sin ejecutar su escena", async () => {
    corridas.length = 0
    // `null` = el usuario ya tenía datos completos (idempotencia).
    const resumen = await correr(
      { "a.ts": escena("a@lucaplan.cl") },
      async () => null
    )

    assert.deepEqual(corridas, [], "no debe re-armar una escena ya sembrada")
    assert.deepEqual(resumen, { sembradas: 0, omitidas: 1, fallidas: 0 })
  })

  it("avisa cuando el correo de la escena queda fuera del dominio que lista el login", async () => {
    const resumen = await correr({ "a.ts": escena("a@otrodominio.cl") })

    // Se siembra igual —los datos existen— pero quedaría invisible en el login.
    assert.deepEqual(resumen, { sembradas: 1, omitidas: 0, fallidas: 0 })
    assert.ok(
      salida.some(
        (l) => l.startsWith("warn") && l.includes("el login NO la va a ofrecer")
      )
    )
  })

  it("sin dominio usable no avisa nada y siembra igual", async () => {
    const resumen = await correrEscenas({
      archivos: ["a.ts"],
      cargar: async () => escena("a@lucaplan.cl"),
      sembrar: sembradorOk,
      password: "clave1234",
      dominio: null,
    })

    assert.equal(resumen.sembradas, 1)
    assert.ok(!salida.some((l) => l.startsWith("warn")))
  })
})

describe("archivosDeEscena", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "escenas-"))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("toma los .ts en orden alfabético y deja fuera lo que no es una escena", () => {
    for (const f of [
      "wdc-74-b.ts",
      "wdc-12-a.ts",
      "correr-escenas.test.ts", // test del propio seed, no una escena
      "notas.md",
    ]) {
      writeFileSync(join(dir, f), "")
    }
    mkdirSync(join(dir, "sub.ts")) // una carpeta que termina en .ts no es un módulo

    assert.deepEqual(archivosDeEscena(dir), ["wdc-12-a.ts", "wdc-74-b.ts"])
  })

  it("sin carpeta devuelve vacío en vez de tirar", () => {
    // El arranque encadena `seed:pr && next start`: un ENOENT acá tumbaría la app entera.
    assert.deepEqual(archivosDeEscena(join(dir, "no-existe")), [])
    assert.ok(salida.some((l) => l.includes("no se pudo leer la carpeta")))
  })
})
