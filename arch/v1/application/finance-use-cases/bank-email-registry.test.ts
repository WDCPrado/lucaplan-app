import assert from "node:assert/strict"
import { test } from "node:test"
import type { BankEmailMessage } from "../../domain/finance/email-connection.domain.ts"
import {
  BANK_EMAIL_REGISTRY,
  UnknownBankError,
  bankByKey,
  routeEmail,
} from "./bank-email-registry.ts"

function message(from: string): BankEmailMessage {
  return {
    id: "m-1",
    internetMessageId: "<m-1@example.test>",
    from,
    subject: "Cargo en Cuenta",
    receivedAt: new Date("2026-08-07T12:00:00Z"),
    htmlBody: "<p>cuerpo</p>",
  }
}

test("un remitente del catálogo se atribuye a su banco", () => {
  const bank = routeEmail(message("enviodigital@bancochile.cl"))
  assert.equal(bank?.key, "bancochile")
})

test("el remitente se compara sin distinguir mayúsculas ni espacios", () => {
  const bank = routeEmail(message("  EnvioDigital@BancoChile.CL "))
  assert.equal(bank?.key, "bancochile")
})

test("un remitente ajeno al catálogo no se atribuye a ningún banco", () => {
  assert.equal(routeEmail(message("newsletter@ejemplo.cl")), null)
})

test("ningún remitente pertenece a dos bancos del catálogo", () => {
  const senders = BANK_EMAIL_REGISTRY.flatMap((b) => b.senders)
  assert.equal(new Set(senders).size, senders.length)
})

test("las claves del catálogo son únicas", () => {
  const keys = BANK_EMAIL_REGISTRY.map((b) => b.key)
  assert.equal(new Set(keys).size, keys.length)
})

test("una clave desconocida falla explícito en vez de caer en otro parser", () => {
  assert.throws(() => bankByKey("banco-inexistente"), UnknownBankError)
})

test("el enrutado respeta un catálogo alternativo (bancos de prueba)", () => {
  const otro = {
    key: "otro",
    name: "Otro Banco",
    senders: ["avisos@otrobanco.cl"],
    parse: () => ({ ok: false, reason: "asunto_desconocido" }) as const,
  }
  const registry = [...BANK_EMAIL_REGISTRY, otro]
  assert.equal(routeEmail(message("avisos@otrobanco.cl"), registry)?.key, "otro")
  assert.equal(
    routeEmail(message("enviodigital@bancochile.cl"), registry)?.key,
    "bancochile"
  )
})
