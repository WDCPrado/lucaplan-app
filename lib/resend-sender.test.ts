import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildSender, nameFromDomain, parseSender, senderSchema } from "./resend-sender.ts"

test("descompone el remitente guardado, con y sin nombre", () => {
  assert.deepEqual(parseSender("Luca Plan <codigos@lucaplan.cl>"), {
    name: "Luca Plan",
    local: "codigos",
    domain: "lucaplan.cl",
  })
  assert.deepEqual(parseSender("codigos@LucaPlan.cl"), {
    name: "",
    local: "codigos",
    domain: "lucaplan.cl",
  })
  assert.equal(parseSender("no es un correo"), null)
  assert.equal(parseSender(null), null)
})

test("propone el nombre desde el dominio y arma el tag", () => {
  assert.equal(nameFromDomain("lucaplan.cl"), "Lucaplan")
  assert.equal(
    buildSender({ name: "Lucaplan", local: "notificaciones", domain: "lucaplan.cl" }),
    "Lucaplan <notificaciones@lucaplan.cl>"
  )
  assert.equal(buildSender({ name: " ", local: "a", domain: "b.cl" }), "a@b.cl")
})

test("valida dominio y parte local", () => {
  const ok = { name: "X", local: "notificaciones", domain: "lucaplan.cl" }
  assert.ok(senderSchema.safeParse(ok).success)
  assert.ok(!senderSchema.safeParse({ ...ok, domain: "lucaplan" }).success)
  assert.ok(!senderSchema.safeParse({ ...ok, domain: "luca plan.cl" }).success)
  assert.ok(!senderSchema.safeParse({ ...ok, local: "a..b" }).success)
  assert.ok(!senderSchema.safeParse({ ...ok, name: "a <b>" }).success)
})
