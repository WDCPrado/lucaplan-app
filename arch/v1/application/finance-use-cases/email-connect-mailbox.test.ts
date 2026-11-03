// Alta y reconexión del BUZÓN: que la fila diga de qué proveedor es el correo en vez de dar Outlook
// por sentado. Es lo que después usa el router para elegir con quién hablar.
// node --test arch/v1/application/finance-use-cases/email-connect-mailbox.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"
import type {
  EmailMailbox,
  EmailMailboxPatch,
  NewEmailMailbox,
} from "../../domain/finance/email-connection.domain.ts"
import { connectMailbox } from "./email-connection-use-cases.ts"

const mailbox = (over: Partial<EmailMailbox> = {}): EmailMailbox => ({
  id: "mbx-1",
  userId: "user-1",
  emailProvider: "outlook",
  emailAddress: "sanitized@example.test",
  status: "active",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  deltaLink: null,
  subscriptionId: null,
  subscriptionExpiresAt: null,
  lastSyncedAt: null,
  lastError: null,
  discardedCount: 0,
  ...over,
})

// Repo en memoria que guarda lo que le mandaron: el test observa exactamente eso.
function repo(existing: EmailMailbox | null) {
  const seen: { created?: NewEmailMailbox; patched?: EmailMailboxPatch } = {}
  return {
    seen,
    deps: {
      mailboxes: {
        listByUser: async () => [],
        findById: async () => existing,
        findByAddress: async () => existing,
        findBySubscriptionId: async () => null,
        listForSubscriptionRenewal: async () => [],
        updateIfState: async () => true,
        create: async (input: NewEmailMailbox) => {
          seen.created = input
          return mailbox({ emailProvider: input.emailProvider })
        },
        update: async (_id: string, patch: EmailMailboxPatch) => {
          seen.patched = patch
          return mailbox({ ...existing, ...patch } as Partial<EmailMailbox>)
        },
        delete: async () => {},
      },
    },
  }
}

test("un correo nuevo se guarda con el proveedor por el que se autorizó", async () => {
  const { seen, deps } = repo(null)
  const { reconnected } = await connectMailbox(deps, "user-1", {
    emailProvider: "gmail",
    emailAddress: "alguien@example.test",
    refreshToken: "rt-1",
  })
  assert.equal(reconnected, false)
  assert.equal(seen.created?.emailProvider, "gmail")
})

// Si no se reescribiera, un correo migrado de proveedor quedaría con la fila mintiendo y el router
// seguiría mandándolo al adapter viejo.
test("reconectar por otro proveedor actualiza la fila, no la deja en el anterior", async () => {
  const { seen, deps } = repo(mailbox({ emailProvider: "outlook" }))
  const { mailbox: updated, reconnected } = await connectMailbox(
    deps,
    "user-1",
    {
      emailProvider: "gmail",
      emailAddress: "sanitized@example.test",
      refreshToken: "rt-2",
    }
  )
  assert.equal(reconnected, true)
  assert.equal(seen.patched?.emailProvider, "gmail")
  assert.equal(updated.emailProvider, "gmail")
  // Y lo que ya hacía sigue igual: rota el token y revive el buzón sin borrar sus bancos.
  assert.equal(seen.patched?.refreshToken, "rt-2")
  assert.equal(seen.patched?.status, "active")
  assert.equal(seen.patched?.lastError, null)
})

test("reconectar por el mismo proveedor lo deja donde estaba", async () => {
  const { seen, deps } = repo(mailbox({ emailProvider: "outlook" }))
  await connectMailbox(deps, "user-1", {
    emailProvider: "outlook",
    emailAddress: "sanitized@example.test",
    refreshToken: "rt-3",
  })
  assert.equal(seen.patched?.emailProvider, "outlook")
})
