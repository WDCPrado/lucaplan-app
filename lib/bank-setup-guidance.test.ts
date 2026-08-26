// Corre con: node --test lib/bank-setup-guidance.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  confirmBlocker,
  plural,
  proposedChecking,
  reconcileBlocker,
  refComplete,
  scanGuidance,
  type ScanCandidate,
  type ScanFacts,
  type SetupCard,
} from "./bank-setup-guidance.ts"

const mach: ScanFacts = {
  bankName: "MACHBANK",
  totalMessages: 12,
  primaryCheckingCount: 3,
}
const vacio = { checkingRef: null, cards: [] }
const tarjeta = (over: Partial<SetupCard> = {}): SetupCard => ({
  ref: "2120",
  national: true,
  international: false,
  ...over,
})

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
  assert.equal(confirmBlocker({ checkingRef: "", cards: [] }), falta)
  assert.equal(confirmBlocker({ checkingRef: "12", cards: [] }), falta)
  assert.equal(
    confirmBlocker({ checkingRef: null, cards: [tarjeta({ ref: "999" })] }),
    falta
  )
})

// El agujero que este PR vino a cerrar, en la otra rama del mismo formulario: la tarjeta nace con
// el cupo nacional encendido, el usuario lo apaga para usar el internacional y no enciende ninguno.
// El servidor la rechaza, pero recién después de correr la animación de importación completa.
test("una tarjeta sin ningún cupo bloquea la importación", () => {
  const sinCupos = tarjeta({ national: false, international: false })
  assert.equal(
    confirmBlocker({ checkingRef: null, cards: [sinCupos] }),
    "Enciende el cupo nacional o el internacional de cada tarjeta."
  )
  // Y también cuando hay otra tarjeta bien configurada al lado.
  assert.notEqual(
    confirmBlocker({ checkingRef: "4321", cards: [tarjeta(), sinCupos] }),
    null
  )
})

test("con un cupo cualquiera encendido la tarjeta ya se puede crear", () => {
  assert.equal(confirmBlocker({ checkingRef: null, cards: [tarjeta()] }), null)
  assert.equal(
    confirmBlocker({
      checkingRef: null,
      cards: [tarjeta({ national: false, international: true })],
    }),
    null
  )
})

test("con todos los instrumentos completos no hay nada que bloquee", () => {
  assert.equal(confirmBlocker({ checkingRef: "4321", cards: [] }), null)
  assert.equal(
    confirmBlocker({ checkingRef: "1234567890", cards: [tarjeta()] }),
    null
  )
})

// Actualizar saldos resuelve la cuenta por su referencia: con el campo vacío, el endsWith del
// use-case da verdadero para cualquiera y sobrescribe el saldo de la primera que encuentre.
test("actualizar saldos se bloquea con la referencia vacía", () => {
  assert.equal(
    reconcileBlocker({ checkingRef: "", cards: [] }),
    "Escribe los últimos 4 dígitos de cada cuenta y tarjeta."
  )
  assert.equal(reconcileBlocker({ checkingRef: "8900", cards: [] }), null)
})

test("actualizar saldos NO exige cupos: apagarlos es no tocar ese bucket", () => {
  const sinCupos = tarjeta({ national: false, international: false })
  assert.equal(
    reconcileBlocker({ checkingRef: "8900", cards: [sinCupos] }),
    null
  )
  // Y tampoco exige que haya algún instrumento: ahí no se crea nada.
  assert.equal(reconcileBlocker(vacio), null)
})

// --- Qué cuenta se propone: la línea que decide si el formulario llega vacío ---

const candidatoChecking: ScanCandidate = {
  kind: "checking",
  ref: "12345678",
  last4: "5678",
  movementCount: 9,
}
const candidatoTarjeta: ScanCandidate = {
  kind: "credit_card",
  last4: "2120",
  currencies: ["CLP"],
  movementCount: 4,
}

test("con un candidato numerado se propone ese, con su número", () => {
  assert.deepEqual(
    proposedChecking({
      candidates: [candidatoTarjeta, candidatoChecking],
      primaryCheckingCount: 3,
    }),
    { ref: "12345678", movementCount: 9 }
  )
})

test("sin candidato pero con movimientos sin número se propone una cuenta VACÍA", () => {
  assert.deepEqual(
    proposedChecking({ candidates: [], primaryCheckingCount: 7 }),
    { ref: "", movementCount: 7 }
  )
  // Los dígitos no se inventan: la referencia va vacía para que el usuario la complete.
  assert.deepEqual(
    proposedChecking({
      candidates: [candidatoTarjeta],
      primaryCheckingCount: 7,
    }),
    { ref: "", movementCount: 7 }
  )
})

test("sin candidato y sin movimientos sin número no se propone ninguna cuenta", () => {
  assert.equal(
    proposedChecking({ candidates: [], primaryCheckingCount: 0 }),
    null
  )
  assert.equal(
    proposedChecking({
      candidates: [candidatoTarjeta],
      primaryCheckingCount: 0,
    }),
    null
  )
})

// --- El aviso ---

test("los movimientos sin número se explican con su cuenta y su consecuencia", () => {
  const aviso = scanGuidance(mach, vacio)
  assert.ok(aviso?.includes("MACHBANK"))
  assert.ok(aviso?.includes("3 movimientos"))
  assert.ok(aviso?.includes("últimos 4"))
  // Lo que Willy quería saber: sin cuenta esos movimientos no llegan a categorizarse.
  assert.ok(aviso?.includes("se omiten"))
})

test("un solo movimiento sin número no se anuncia en plural", () => {
  const aviso = scanGuidance({ ...mach, primaryCheckingCount: 1 }, vacio)
  assert.ok(aviso?.includes("en 1 movimiento:"))
})

test("el aviso se calcula contra el formulario: completar la cuenta lo apaga", () => {
  assert.notEqual(scanGuidance(mach, { checkingRef: "", cards: [] }), null)
  assert.equal(scanGuidance(mach, { checkingRef: "4321", cards: [] }), null)
  // Y vuelve si el usuario quita la cuenta que se le propuso.
  assert.notEqual(scanGuidance(mach, vacio), null)
})

test("un instrumento a medio escribir no apaga el aviso de la cuenta principal", () => {
  assert.notEqual(scanGuidance(mach, { checkingRef: "43", cards: [] }), null)
})

test("sin nada que proponer se dice cuántos correos se revisaron", () => {
  const sinCandidatos = { ...mach, primaryCheckingCount: 0 }
  const aviso = scanGuidance(sinCandidatos, vacio)
  assert.ok(aviso?.includes("Ninguno de los 12 correos revisados"))
  assert.ok(aviso?.includes("últimos 4"))
})

test("un solo correo revisado no se cuenta en plural", () => {
  const uno = { ...mach, totalMessages: 1, primaryCheckingCount: 0 }
  const aviso = scanGuidance(uno, vacio)
  assert.ok(aviso?.includes("El único correo revisado"))
  assert.equal(aviso?.includes("1 correos"), false)
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
    scanGuidance(sinCandidatos, { checkingRef: "8900", cards: [] }),
    null
  )
  assert.equal(
    scanGuidance(sinCandidatos, { checkingRef: null, cards: [tarjeta()] }),
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
