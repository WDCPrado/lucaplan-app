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
  isConfigured: async () => configured,
  authorization: async () => ({
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
    notConfiguredError: "falta OUTLOOK_CLIENT_ID",
    oauth: oauth(true),
    mail: spyMail("outlook", calls),
  },
  {
    key: "gmailish",
    name: "Proveedor sin webhook",
    notConfiguredError: "falta GMAIL_CLIENT_ID",
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
  await mail.lastMessageDate(
    "mbx-gm",
    ["banco@example.test"],
    new Date(),
    new Date()
  )
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
  assert.equal(
    emailProviderByKey("gmailish", registry).name,
    "Proveedor sin webhook"
  )
  assert.throws(
    () => emailProviderByKey("yahoo", registry),
    UnknownEmailProviderError
  )
})

// /status entrega el catálogo COMPLETO con su bandera: la UI ofrece solo los configurados, pero
// necesita el nombre de los demás para rotular un buzón ya conectado.
test("availableEmailProviders marca cuáles tiene configurados el servidor", async () => {
  assert.deepEqual(await availableEmailProviders(registryOf([])), [
    { key: "outlook", name: "Outlook", configured: true },
    { key: "gmailish", name: "Proveedor sin webhook", configured: false },
  ])
})

// El adapter cachea su token en memoria y ya no relee la fila, así que preguntar el proveedor en
// cada método sería costo neto. En un lote de webhook (hasta 100 mensajes de un buzón) esto es la
// diferencia entre 1 consulta y 100.
test("el proveedor del buzón se consulta UNA vez por router, no por llamada", async () => {
  const calls: string[] = []
  let consultas = 0
  const mail = makeMailRouter(async (id) => {
    consultas++
    return providerOf[id]
  }, registryOf(calls))

  await mail.fetchMessage("mbx-out", "m1")
  await mail.fetchMessage("mbx-out", "m2")
  await mail.fetchMessage("mbx-out", "m3")
  assert.equal(consultas, 1)

  // Otro buzón sí se consulta: la caché es por buzón, no una global.
  await mail.fetchMessage("mbx-gm", "m4")
  assert.equal(consultas, 2)
})

test("llamadas en paralelo sobre el mismo buzón comparten una sola consulta", async () => {
  const calls: string[] = []
  let consultas = 0
  const mail = makeMailRouter(async (id) => {
    consultas++
    await new Promise((r) => setTimeout(r, 5))
    return providerOf[id]
  }, registryOf(calls))

  await Promise.all([
    mail.fetchMessage("mbx-out", "m1"),
    mail.fetchMessage("mbx-out", "m2"),
    mail.fetchMessage("mbx-out", "m3"),
  ])
  assert.equal(consultas, 1)
})

// La caché no puede sobrevivir a la operación: si el buzón se reconecta por otro proveedor, el
// router siguiente tiene que ver el nuevo. Por eso se crea uno por operación y no hay singleton.
test("un router nuevo vuelve a consultar: la caché no cruza operaciones", async () => {
  const calls: string[] = []
  let proveedor = "outlook"
  let consultas = 0
  const nuevoRouter = () =>
    makeMailRouter(async () => {
      consultas++
      return proveedor
    }, registryOf(calls))

  await nuevoRouter().startDelta("mbx-out", new Date())
  proveedor = "gmailish" // el correo se reconectó por otro proveedor
  await nuevoRouter().startDelta("mbx-out", new Date())

  assert.equal(consultas, 2)
  assert.deepEqual(calls, [
    "outlook:startDelta:mbx-out",
    "gmailish:startDelta:mbx-out",
  ])
})

// Un fallo no se memoiza: si se cacheara la promesa rechazada, un error transitorio dejaría el
// buzón roto para el resto de la operación.
test("una consulta que falla no queda cacheada", async () => {
  const calls: string[] = []
  let intentos = 0
  const mail = makeMailRouter(async () => {
    intentos++
    if (intentos === 1) throw new Error("la base no respondió")
    return "outlook"
  }, registryOf(calls))

  await assert.rejects(() => mail.startDelta("mbx-out", new Date()))
  assert.equal(await mail.startDelta("mbx-out", new Date()), "outlook-delta")
  assert.equal(intentos, 2)
})
