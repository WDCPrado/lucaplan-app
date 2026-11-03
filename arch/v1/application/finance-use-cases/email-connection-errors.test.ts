import assert from "node:assert/strict"
import test from "node:test"
import { LockBusyError } from "../../../shared/mutex.ts"
import type { EmailMailbox, EmailMailboxPatch } from "../../domain/finance/email-connection.domain.ts"
import type { PushMessage } from "../../domain/notifications/push.domain.ts"
import { markSyncError, renewMailboxSubscriptions, syncWebhookMessages, type EmailConnectionDeps } from "./email-connection-use-cases.ts"

function setup() {
  let row: EmailMailbox = {
    id: "mailbox", userId: "user", emailProvider: "outlook", emailAddress: "demo@example.test",
    status: "active", createdAt: new Date("2026-10-01"), deltaLink: null,
    subscriptionId: "sub", subscriptionExpiresAt: new Date("2099-01-01"),
    lastSyncedAt: null, lastError: null, discardedCount: 0,
  }
  const notices: PushMessage[] = []
  const deps: EmailConnectionDeps = {
    mailboxes: {
      findById: async () => ({ ...row }), findByAddress: async () => ({ ...row }),
      findBySubscriptionId: async () => ({ ...row }), listByUser: async () => [{ ...row }],
      listForSubscriptionRenewal: async () => [{ ...row }], create: async () => ({ ...row }), delete: async () => {},
      update: async (_id, patch) => { row = { ...row, ...patch }; return { ...row } },
      updateIfState: async (_id, expected, patch) => {
        if (row.status !== expected.status || row.lastError !== expected.lastError) return false
        row = { ...row, ...patch }
        return true
      },
    },
    mail: {
      fetchMessage: async () => null, ensureSubscription: async () => ({ subscriptionId: "sub", expiresAt: new Date("2099-01-01") }),
      deleteSubscription: async () => {}, startDelta: async () => "delta", runDelta: async () => ({ messages: [], deltaLink: "delta" }),
      listMessagesSince: async () => [], lastMessageDate: async () => null,
    },
    links: { listByMailbox: async () => [] } as unknown as EmailConnectionDeps["links"],
    methods: {} as EmailConnectionDeps["methods"], store: {} as EmailConnectionDeps["store"],
    notifyConnectionError: async (userId, message) => { assert.equal(userId, "user"); notices.push(message) },
  }
  return { deps, notices, row: () => ({ ...row }), patch: (patch: EmailMailboxPatch) => { row = { ...row, ...patch } } }
}

test("un incidente transitorio notifica una vez incluso con fallos concurrentes y nunca filtra el error", async () => {
  const { deps, notices, row } = setup()
  const error = new Error("Bearer SECRET correo@privado.test cuerpo del correo")
  await Promise.all([markSyncError(deps, row(), error), markSyncError(deps, row(), error)])
  await markSyncError(deps, row(), error)
  assert.equal(row().status, "error")
  assert.equal(notices.length, 1)
  assert.equal(notices[0].url, "/settings")
  assert.doesNotMatch(JSON.stringify([row().lastError, notices]), /SECRET|privado|cuerpo/)
  assert.doesNotMatch(notices[0].body, /reconecta/i)
})

test("autorización revocada pide reconectar y no se degrada ante un fallo transitorio", async () => {
  const { deps, notices, row } = setup()
  const error = Object.assign(new Error("private token"), { name: "EmailReauthRequiredError" })
  await markSyncError(deps, row(), new Error("network"))
  await markSyncError(deps, row(), error)
  await markSyncError(deps, row(), new Error("network"))
  assert.equal(row().status, "reauth_required")
  assert.equal(notices.length, 2)
  assert.match(notices[1].body, /Reconecta/)
})

test("fetch del webhook falla antes de sync, deja aviso y se recupera en el reintento", async () => {
  const { deps, notices, row } = setup()
  deps.mail.fetchMessage = async () => { throw new Error("network") }
  await assert.rejects(syncWebhookMessages(deps, row(), ["message"]))
  assert.equal(row().status, "error")
  assert.equal(notices.length, 1)
  deps.mail.fetchMessage = async () => null
  await syncWebhookMessages(deps, row(), ["message"])
  assert.equal(row().status, "active")
  assert.equal(row().lastError, null)
  deps.mail.fetchMessage = async () => { throw new Error("network again") }
  await assert.rejects(syncWebhookMessages(deps, row(), ["message"]))
  assert.equal(notices.length, 2)
})

test("renovación fallida avisa, deduplica y una renovación exitosa limpia el estado", async () => {
  const { deps, notices, row } = setup()
  deps.mail.ensureSubscription = async () => { throw new Error("network") }
  assert.equal((await renewMailboxSubscriptions(deps)).failed, 1)
  await renewMailboxSubscriptions(deps)
  assert.equal(notices.length, 1)
  deps.mail.ensureSubscription = async () => ({ subscriptionId: "new", expiresAt: new Date("2099-02-01") })
  assert.equal((await renewMailboxSubscriptions(deps)).renewed, 1)
  assert.equal(row().status, "active")
  assert.equal(row().lastError, null)
  assert.equal(row().subscriptionId, "new")
})

test("éxito de renovación no borra un error posterior y no reintenta autorización revocada", async () => {
  const { deps, row, patch } = setup()
  deps.mail.ensureSubscription = async () => {
    await markSyncError(deps, row(), new Error("concurrent failure"))
    return { subscriptionId: "new", expiresAt: new Date("2099-02-01") }
  }
  await renewMailboxSubscriptions(deps)
  assert.equal(row().status, "error")
  patch({ status: "reauth_required" })
  deps.mail.ensureSubscription = async () => { assert.fail("no solicitar tokens") }
  assert.equal((await renewMailboxSubscriptions(deps)).renewed, 0)
})

test("el lock ocupado pide reintento sin aviso de error", async () => {
  const { deps, notices, row } = setup()
  deps.mail.fetchMessage = async () => { throw new LockBusyError() }
  await assert.rejects(syncWebhookMessages(deps, row(), ["message"]), LockBusyError)
  assert.equal(row().status, "active")
  assert.equal(notices.length, 0)
})

test("un fallo de push no rompe el aviso persistido ni repite el incidente", async () => {
  const { deps, row } = setup()
  let attempts = 0
  deps.notifyConnectionError = async () => { attempts++; throw new Error("push offline") }
  await markSyncError(deps, row(), new Error("network"))
  await markSyncError(deps, row(), new Error("network"))
  assert.equal(attempts, 1)
  assert.equal(row().status, "error")
})

test("fallo al procesar los mensajes válidos también deja aviso", async () => {
  const { deps, row, notices } = setup()
  deps.links.listByMailbox = async () => { throw new Error("private database failure") }
  await assert.rejects(syncWebhookMessages(deps, row(), ["message"]))
  assert.equal(row().status, "error")
  assert.equal(notices.length, 1)
  assert.doesNotMatch(row().lastError!, /private database/)
})

test("renovación con autorización revocada exige reconectar y no pierde el aviso tras sync", async () => {
  const { deps, row, notices, patch } = setup()
  patch({ subscriptionExpiresAt: new Date("2020-01-01") })
  deps.mail.ensureSubscription = async () => { throw Object.assign(new Error("private token"), { name: "EmailReauthRequiredError" }) }
  await syncWebhookMessages(deps, row(), ["message"])
  assert.equal(row().status, "reauth_required")
  assert.equal(notices.length, 1)
  assert.match(row().lastError!, /Reconecta/)
  assert.equal((await renewMailboxSubscriptions(deps)).renewed, 0)
})

test("autorización revocada durante fetch no se limpia al releer el buzón para importar", async () => {
  const { deps, row, notices } = setup()
  deps.mail.fetchMessage = async () => {
    await markSyncError(deps, row(), Object.assign(new Error("private token"), { name: "EmailReauthRequiredError" }))
    return null
  }
  await assert.rejects(syncWebhookMessages(deps, row(), ["message"]), { name: "EmailReauthRequiredError" })
  assert.equal(row().status, "reauth_required")
  assert.match(row().lastError!, /Reconecta/)
  assert.equal(notices.length, 1)
  assert.equal(row().lastSyncedAt, null)
})
