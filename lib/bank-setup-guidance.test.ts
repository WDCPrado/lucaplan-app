// Corre con: node --test lib/bank-setup-guidance.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  confirmBlocker,
  plural,
  refComplete,
  scanGuidance,
  type ScanFacts,
} from "./bank-setup-guidance.ts"

const mach: ScanFacts = {
  bankName: "MACHBANK",
  totalMessages: 12,
  primaryCheckingCount: 3,
}
const vacio = { checkingRef: null, cardRefs: [] }

test("refComplete: cuenta los dígitos, no los caracteres escritos", () => {
  assert.equal(refComplete(""), false)
  assert.equal(refComplete("123"), false)
  assert.equal(refComplete("12-3"), false)
  assert.equal(refComplete("4321"), true)
  assert.equal(refComplete("00-12 3456"), true)
})

test("sin instrumentos no se puede importar, y se dice por qué", () => {
  assert.equal(
    confirmBlocker(vacio),
    "Agrega tu cuenta corriente o tu tarjeta para poder importar."
  )
})

test("un instrumento a medio escribir bloquea la importación", () => {
  const falta = "Escribe los últimos 4 dígitos de cada cuenta y tarjeta."
  assert.equal(confirmBlocker({ checkingRef: "", cardRefs: [] }), falta)
  assert.equal(confirmBlocker({ checkingRef: "12", cardRefs: [] }), falta)
  assert.equal(confirmBlocker({ checkingRef: null, cardRefs: ["999"] }), falta)
  assert.equal(
    confirmBlocker({ checkingRef: "4321", cardRefs: ["2120", "1"] }),
    falta
  )
})

test("con todos los instrumentos completos no hay nada que bloquee", () => {
  assert.equal(confirmBlocker({ checkingRef: "4321", cardRefs: [] }), null)
  assert.equal(
    confirmBlocker({ checkingRef: "1234567890", cardRefs: ["2120"] }),
    null
  )
})

test("los movimientos sin número se explican con su cuenta y su consecuencia", () => {
  const aviso = scanGuidance(mach, vacio)
  assert.ok(aviso?.includes("MACHBANK"))
  assert.ok(aviso?.includes("3 movimientos"))
  assert.ok(aviso?.includes("últimos 4"))
  // Lo que Willy quería saber: sin cuenta esos movimientos no llegan a categorizarse.
  assert.ok(aviso?.includes("se omiten"))
})

test("el aviso se calcula contra el formulario: completar la cuenta lo apaga", () => {
  assert.equal(
    scanGuidance(mach, { checkingRef: "", cardRefs: [] }) !== null,
    true
  )
  assert.equal(scanGuidance(mach, { checkingRef: "4321", cardRefs: [] }), null)
  // Y vuelve si el usuario quita la cuenta que se le propuso.
  assert.notEqual(scanGuidance(mach, vacio), null)
})

test("un instrumento a medio escribir no apaga el aviso de la cuenta principal", () => {
  assert.notEqual(scanGuidance(mach, { checkingRef: "43", cardRefs: [] }), null)
})

test("sin nada que proponer se dice cuántos correos se revisaron", () => {
  const sinCandidatos = { ...mach, primaryCheckingCount: 0 }
  const aviso = scanGuidance(sinCandidatos, vacio)
  assert.ok(aviso?.includes("12 correos revisados"))
  assert.ok(aviso?.includes("últimos 4"))
})

test("un buzón sin avisos del banco no se explica con cero correos revisados", () => {
  const sinCorreos = { ...mach, totalMessages: 0, primaryCheckingCount: 0 }
  const aviso = scanGuidance(sinCorreos, vacio)
  assert.ok(aviso?.includes("Todavía no hay avisos de MACHBANK"))
  assert.equal(aviso?.includes("0 correos"), false)
})

test("con candidatos propuestos y nada en riesgo no se agrega ruido", () => {
  const sinCandidatos = { ...mach, primaryCheckingCount: 0 }
  assert.equal(
    scanGuidance(sinCandidatos, { checkingRef: "8900", cardRefs: [] }),
    null
  )
  assert.equal(
    scanGuidance(sinCandidatos, { checkingRef: null, cardRefs: ["2120"] }),
    null
  )
})

test("plural: el conteo va en el texto, así que el plural también", () => {
  assert.equal(
    plural(1, "gasto detectado", "gastos detectados"),
    "1 gasto detectado"
  )
  assert.equal(plural(0, "correo", "correos"), "0 correos")
  assert.equal(plural(2, "correo", "correos"), "2 correos")
})
