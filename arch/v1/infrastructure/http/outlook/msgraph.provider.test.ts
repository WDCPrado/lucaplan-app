import assert from "node:assert/strict"
import test from "node:test"
import { prisma } from "../../database/prisma/client.ts"
import { encryptSecret, EMAIL_PURPOSE } from "../../crypto/secret-crypto.ts"
import { EmailDeltaExpiredError } from "../../../domain/finance/email-connection.domain.ts"
import { msgraphMailProvider } from "./msgraph.provider.ts"

test("Graph distingue cursor expirado y rechaza listados truncados sin exponer respuestas", async (t) => {
  const previousKey = process.env.BANCOCHILE_ENC_KEY
  const previousClient = process.env.OUTLOOK_CLIENT_ID
  process.env.BANCOCHILE_ENC_KEY = "test-only-master-key-at-least-32-characters"
  process.env.OUTLOOK_CLIENT_ID = "test-client"
  t.after(() => {
    if (previousKey === undefined) delete process.env.BANCOCHILE_ENC_KEY
    else process.env.BANCOCHILE_ENC_KEY = previousKey
    if (previousClient === undefined) delete process.env.OUTLOOK_CLIENT_ID
    else process.env.OUTLOOK_CLIENT_ID = previousClient
  })
  const { enc, iv } = encryptSecret("test-refresh", EMAIL_PURPOSE)
  const mailboxRepo = prisma.emailMailbox as unknown as {
    findUnique: (...args: unknown[]) => Promise<unknown>
  }
  const findUnique = mailboxRepo.findUnique
  t.after(() => {
    mailboxRepo.findUnique = findUnique
  })
  mailboxRepo.findUnique = async () => ({
    refreshTokenEnc: enc,
    refreshTokenIv: iv,
  })
  let status = 410
  let pages = 0
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (String(input).startsWith("https://login.microsoftonline.com/")) {
      return Response.json({ access_token: "test-access", expires_in: 3600 })
    }
    if (status !== 200) return new Response("must-not-leak", { status })
    pages++
    return Response.json({
      value: [],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/next",
    })
  })

  await assert.rejects(
    msgraphMailProvider.runDelta(
      "test-mailbox",
      "https://graph.microsoft.com/v1.0/expired"
    ),
    EmailDeltaExpiredError
  )
  status = 429
  await assert.rejects(
    msgraphMailProvider.runDelta(
      "test-mailbox",
      "https://graph.microsoft.com/v1.0/throttled"
    ),
    (error: Error) => {
      assert.equal(error instanceof EmailDeltaExpiredError, false)
      assert.equal(error.message, "Microsoft Graph respondió 429")
      return true
    }
  )
  status = 200
  await assert.rejects(
    msgraphMailProvider.listMessagesSince(
      "test-mailbox",
      new Date("2026-07-01")
    ),
    /límite de páginas/
  )
  assert.equal(pages, 40)
})
