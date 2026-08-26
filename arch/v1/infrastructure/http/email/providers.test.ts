// Enrutado de la conexión de correo por proveedor: que cada buzón hable con SU adapter y que un
// proveedor desconocido falle en vez de caer en el de otro.
// node --test arch/v1/infrastructure/http/email/providers.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"
import type {
  BankEmailMessage,
  BankMailProvider,
} from "../../../domain/finance/email-connection.domain.ts"
import {
  availableEmailProviders,
  emailProviderByKey,
  makeMailRouter,
  UnknownEmailProviderError,
  type EmailProviderDefinition,
} from "./providers.ts"

// Adapter de mentira que anota con qué buzón lo llamaron: es lo único que los tests observan.
function spyMail(tag: string, calls: string[]): BankMailProvider {
  return {
    async listMessagesSince(mailboxId) {
      calls.push(`${tag}:listMessagesSince:${mailboxId}`)
      return []
    },
    async lastMessageDate(mailboxId) {
      calls.push(`${tag}:lastMessageDate:${mailboxId}`)
      return null
    },
    async startDelta(mailboxId) {
      calls.push(`${tag}:startDelta:${mailboxId}`)
      return `${tag}-delta`
    },
    async runDelta(mailboxId) {
      calls.push(`${tag}:runDelta:${mailboxId}`)
      return { messages: [] as BankEmailMessage[], deltaLink: `${tag}-delta` }
    },
    async fetchMessage(mailboxId) {
      calls.push(`${tag}:fetchMessage:${mailboxId}`)
      return null
    },
    async ensureSubscription(mailboxId) {
      calls.push(`${tag}:ensureSubscription:${mailboxId}`)
      return tag === "gmailish"
        ? null // un proveedor sin suscripción que renovar devuelve null, no revienta
        : { subscriptionId: `${tag}-sub`, expiresAt: new Date("2026-09-01") }
    },
    async deleteSubscription(mailboxId) {
      calls.push(`${tag}:deleteSubscription:${mailboxId}`)
    },
  }
}

const oauth = (configured: boolean) => ({
  isConfigured: () => configured,
  authorization: () => ({
    url: "https://example.test/authorize",
    pkceVerifier: "verifier",
    secureCookie: true,
  }),
  exchangeCode: async () => ({ refreshToken: null, emailAddress: null }),
})

const registryOf = (calls: string[]): EmailProviderDefinition[] => [
  {
    key: "outlook",
    name: "Outlook",
    oauth: oauth(true),
    mail: spyMail("outlook", calls),
  },
  {
    key: "gmailish",
    name: "Proveedor sin webhook",
    oauth: oauth(false),
    mail: spyMail("gmailish", calls),
  },
]

// Buzones de distintos proveedores conviviendo: es el punto de toda la tarjeta.
const providerOf: Record<string, string> = {
  "mbx-out": "outlook",
  "mbx-gm": "gmailish",
  "mbx-raro": "proveedor-que-ya-no-existe",
}

const router = (calls: string[]) =>
  makeMailRouter(async (id) => providerOf[id], registryOf(calls))

test("cada buzón se atiende con el adapter de SU proveedor", async () => {
  const calls: string[] = []
  const mail = router(calls)
  await mail.startDelta("mbx-out", new Date("2026-07-01"))
  await mail.startDelta("mbx-gm", new Date("2026-07-01"))
  assert.deepEqual(calls, [
    "outlook:startDelta:mbx-out",
    "gmailish:startDelta:mbx-gm",
  ])
})

test("el buzón manda en TODOS los métodos del port, no solo en el primero", async () => {
  const calls: string[] = []
  const mail = router(calls)
  await mail.listMessagesSince("mbx-gm", new Date("2026-07-01"))
  await mail.lastMessageDate("mbx-gm", ["banco@example.test"], new Date(), new Date())
  await mail.runDelta("mbx-gm", "delta")
  await mail.fetchMessage("mbx-gm", "msg-1")
  await mail.ensureSubscription("mbx-gm")
  await mail.deleteSubscription("mbx-gm")
  assert.equal(
    calls.every((c) => c.startsWith("gmailish:")),
    true,
    `algún método se fue al adapter equivocado: ${calls.join(", ")}`
  )
  assert.equal(calls.length, 6)
})

test("el resultado del adapter vuelve tal cual al llamador", async () => {
  const calls: string[] = []
  const mail = router(calls)
  assert.equal(await mail.startDelta("mbx-out", new Date()), "outlook-delta")
  // Un proveedor sin suscripción que renovar devuelve null: /renew lo cuenta como "nada que hacer".
  assert.equal(await mail.ensureSubscription("mbx-gm"), null)
  assert.deepEqual(await mail.ensureSubscription("mbx-out"), {
    subscriptionId: "outlook-sub",
    expiresAt: new Date("2026-09-01"),
  })
})

test("un buzón con un proveedor fuera del catálogo falla en vez de caer en otro adapter", async () => {
  const calls: string[] = []
  await assert.rejects(
    () => router(calls).startDelta("mbx-raro", new Date()),
    UnknownEmailProviderError
  )
  assert.deepEqual(calls, [], "no debió llamarse a ningún adapter")
})

test("emailProviderByKey devuelve el del catálogo y lanza con una clave desconocida", () => {
  const registry = registryOf([])
  assert.equal(emailProviderByKey("gmailish", registry).name, "Proveedor sin webhook")
  assert.throws(
    () => emailProviderByKey("yahoo", registry),
    UnknownEmailProviderError
  )
})

// /status entrega el catálogo COMPLETO con su bandera: la UI ofrece solo los configurados, pero
// necesita el nombre de los demás para rotular un buzón ya conectado.
test("availableEmailProviders marca cuáles tiene configurados el servidor", () => {
  assert.deepEqual(availableEmailProviders(registryOf([])), [
    { key: "outlook", name: "Outlook", configured: true },
    { key: "gmailish", name: "Proveedor sin webhook", configured: false },
  ])
})
