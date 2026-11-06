import { test } from "node:test"
import assert from "node:assert/strict"
import { RECURRING_INPUT_MAX, RECURRING_URL_MAX, recurringUrlSchema } from "./recurring-url.ts"

const parse = (v: unknown) => recurringUrlSchema.safeParse(v)

test("Un enlace con https o http se guarda tal cual, sin espacios a los lados.", () => {
  assert.equal(parse("  https://www.enel.cl/pagos ").data, "https://www.enel.cl/pagos")
  assert.equal(parse("http://portal.aguas.cl").data, "http://portal.aguas.cl")
})

test("Sin esquema se asume https.", () => {
  assert.equal(parse("www.enel.cl").data, "https://www.enel.cl")
  assert.equal(parse("enel.cl/pagos").data, "https://enel.cl/pagos")
  assert.equal(parse("enel.cl:8080/x").data, "https://enel.cl:8080/x")
})

test("Vacío, solo espacios, null o ausente se guardan como null.", () => {
  for (const v of ["", "   ", null, undefined]) assert.equal(parse(v).data, null)
})

test("Rechaza esquemas que no son http/https con el mensaje en español.", () => {
  for (const v of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,hola", "ftp://enel.cl", "mailto:a@b.cl"]) {
    const r = parse(v)
    assert.equal(r.success, false, v)
    assert.equal(r.error?.issues[0]?.message, "Escribe un enlace válido, como https://www.enel.cl")
  }
})

test("Rechaza texto que no es un enlace y enlaces demasiado largos.", () => {
  assert.equal(parse("hola mundo").success, false)
  assert.equal(parse(`https://enel.cl/${"a".repeat(RECURRING_URL_MAX)}`).success, false)
  const justo = `https://enel.cl/${"a".repeat(RECURRING_URL_MAX - "https://enel.cl/".length)}`
  assert.equal(parse(justo).data, justo)
})

test("Detecta el enlace como WhatsApp: dentro de un texto, sin https ni www, y sin la puntuación final.", () => {
  assert.equal(parse("Paga en enel.cl/pagos por favor").data, "https://enel.cl/pagos")
  assert.equal(parse("entra a www.aguasandinas.cl.").data, "https://www.aguasandinas.cl")
  assert.equal(parse("ENEL.CL").data, "https://ENEL.CL")
  assert.equal(parse("(https://portal.entel.cl/mi-cuenta?x=1)").data, "https://portal.entel.cl/mi-cuenta?x=1")
  assert.equal(parse("Portal: www.enel.cl").data, "https://www.enel.cl")
  assert.equal(parse("Pago: https://enel.cl/x").data, "https://enel.cl/x")
})

test("Sin terminación de dominio, o solo un correo, no es un enlace.", () => {
  for (const v of ["enel", "https://enel", "pagar@enel.cl", "123.45"]) assert.equal(parse(v).success, false, v)
})

test("Un texto enorme se rechaza al tiro, sin colgar el servidor con las expresiones regulares.", () => {
  // Sin tope previo, `trailing` recorría el texto de forma cuadrática: 1 MB de puntos bloqueaba Node.
  const enorme = `https://enel.cl/${".".repeat(1_000_000)}a`
  const start = performance.now()
  const r = parse(enorme)
  assert.ok(performance.now() - start < 200, "responde en menos de 200 ms")
  assert.equal(r.success, false)
  assert.equal(r.error?.issues[0]?.message, "Escribe un enlace válido, como https://www.enel.cl")
})

test("La puntuación final se recorta en tiempo lineal aun dentro del tope de entrada.", () => {
  const texto = `enel.cl/${".".repeat(RECURRING_INPUT_MAX - 20)}a.`
  const start = performance.now()
  parse(texto)
  assert.ok(performance.now() - start < 50, "responde en menos de 50 ms")
})
