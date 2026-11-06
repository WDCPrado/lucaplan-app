import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  buildSender,
  cleanDomain,
  cleanLocal,
  cleanName,
  nameFromDomain,
  parseSender,
  senderSchema,
} from "./resend-sender.ts"

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

test("un nombre con puntuación va entre comillas y se vuelve a leer igual", () => {
  const sender = { name: "Plan, Luca", local: "a", domain: "b.cl" }
  assert.equal(buildSender(sender), '"Plan, Luca" <a@b.cl>')
  assert.deepEqual(parseSender(buildSender(sender)), sender)
  assert.equal(buildSender({ ...sender, name: "Luca Plan" }), "Luca Plan <a@b.cl>")
  assert.equal(buildSender({ ...sender, name: "Luca Plan S.A." }), '"Luca Plan S.A." <a@b.cl>')
})

test("sanea lo que se pega en cada parte", () => {
  assert.equal(cleanDomain(" LucaPlan.cl "), "lucaplan.cl")
  assert.equal(cleanLocal("notificaciones@lucaplan.cl"), "notificaciones")
  assert.equal(cleanLocal("no ti<fi>"), "notifi")
  assert.equal(cleanName('Luca "Plan" <x>'), "Luca Plan x")
})
