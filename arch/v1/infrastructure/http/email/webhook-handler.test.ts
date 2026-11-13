import assert from "node:assert/strict"
import test from "node:test"
import { LockBusyError } from "../../../../shared/mutex.ts"
import type { EmailMailbox } from "../../../domain/finance/email-connection.domain.ts"
import { handleEmailWebhook } from "./webhook-handler.ts"

const mailbox = { id: "mail", userId: "user", status: "active" } as EmailMailbox
const valid = { subscriptionId: "sub", clientState: "secret", resourceData: { id: "message" } }
const request = (value: unknown) => new Request("https://example.test/webhook", { method: "POST", body: JSON.stringify({ value }) })
function setup() {
  const calls: { mailbox: EmailMailbox; ids: string[] }[] = []
  const deps = {
    mailboxes: { findBySubscriptionId: async (id: string) => id === "sub" ? mailbox : null },
    clientState: () => "secret",
    process: async (mailbox: EmailMailbox, ids: string[]) => { calls.push({ mailbox, ids }) },
    defer: (work: () => Promise<void>) => { void work() },
  }
  return { deps, calls }
}

test("validación Graph responde texto sin consultar buzones", async () => {
  const { deps, calls } = setup()
  deps.mailboxes.findBySubscriptionId = async () => { assert.fail("sin IO") }
  const result = await handleEmailWebhook(new Request("https://example.test/webhook?validationToken=hello"), deps)
  assert.equal(await result.text(), "hello")
  assert.equal(result.status, 200)
  assert.equal(calls.length, 0)
})

test("notificaciones inválidas no procesan ni generan avisos, incluso con secretos Unicode", async () => {
  const { deps, calls } = setup()
  const result = await handleEmailWebhook(request([null, {}, { ...valid, subscriptionId: "unknown" }, { ...valid, clientState: "sécret" }, { ...valid, clientState: 42 }]), deps)
  assert.equal(result.status, 202)
  assert.equal(calls.length, 0)
  assert.equal((await handleEmailWebhook(request({ invalid: true }), deps)).status, 400)
  assert.equal((await handleEmailWebhook(request(Array(101).fill(valid)), deps)).status, 413)
})

test("webhook en error sigue procesándose y responde 202 sin esperar el procesamiento", async () => {
  const { deps, calls } = setup()
  deps.mailboxes.findBySubscriptionId = async () => ({ ...mailbox, status: "error" })
  assert.equal((await handleEmailWebhook(request([valid]), deps)).status, 202)
  assert.equal(calls.length, 1)
  // Graph corta si tardamos: el 202 sale antes de que termine el trabajo, y un fallo no lo cambia.
  const deferred: (() => Promise<void>)[] = []
  deps.defer = (work) => { deferred.push(work) }
  deps.process = async () => { throw new LockBusyError() }
  const result = await handleEmailWebhook(request([valid]), deps)
  assert.equal(result.status, 202)
  assert.equal(await result.text(), "")
  assert.equal(deferred.length, 1)
  await assert.rejects(deferred[0](), LockBusyError)
})

test("un buzón requiere reconectar y no consume tokens; los otros del lote sí se procesan", async () => {
  const { deps, calls } = setup()
  deps.mailboxes.findBySubscriptionId = async (id) => id === "revoked"
    ? { ...mailbox, id: "revoked", status: "reauth_required" } : mailbox
  assert.equal((await handleEmailWebhook(request([{ ...valid, subscriptionId: "revoked" }, valid]), deps)).status, 202)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].mailbox.id, "mail")
})
