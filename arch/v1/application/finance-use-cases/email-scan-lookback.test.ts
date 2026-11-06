// Primer escaneo del correo al conectar un banco: mira los últimos 3 meses (WDC-181).
// Corre con: node --test arch/v1/application/finance-use-cases/email-scan-lookback.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"
import type {
  BankEmailMessage,
  EmailBankLink,
  EmailBankLinkWithMailbox,
  EmailMailbox,
} from "../../domain/finance/email-connection.domain.ts"
import { scanEmailCandidates } from "./email-connection-use-cases.ts"
import { SCAN_LOOKBACK_MONTHS } from "../../../../lib/onboarding-schemas.ts"

const message = (id: string, receivedAt: string): BankEmailMessage => ({
  id,
  internetMessageId: `<${id}@example.test>`,
  from: "enviodigital@bancochile.cl",
  subject: "Compra con Tarjeta de Crédito",
  receivedAt: new Date(receivedAt),
  htmlBody: "Compra por $ 12.345 en COMERCIO PRUEBA con tu tarjeta terminada en 1234 el 14/07/2026.",
})

const mailbox: EmailMailbox = {
  id: "mbx-1",
  userId: "user-1",
  emailProvider: "outlook",
  emailAddress: "sanitized@example.test",
  status: "active",
  createdAt: new Date("2026-07-14T12:00:00Z"),
  deltaLink: null,
  subscriptionId: null,
  subscriptionExpiresAt: null,
  lastSyncedAt: null,
  lastError: null,
  discardedCount: 0,
}

const link: EmailBankLinkWithMailbox = {
  id: "link-1",
  mailboxId: "mbx-1",
  userId: "user-1",
  bankProvider: "bancochile",
  label: null,
  bankId: null,
  status: "pending_setup",
  createdAt: new Date("2026-07-14T12:00:00Z"), // se conecta el 14 de julio
  skippedCount: 0,
  lastBalanceReconciledAt: null,
  mailbox,
}

// Buzón falso que filtra por rango y remitente como Graph.
function scan(messages: BankEmailMessage[]) {
  const requested: Date[] = []
  const inRange = (m: BankEmailMessage, since: Date, until: Date, senders: string[]) =>
    senders.includes(m.from) && m.receivedAt >= since && m.receivedAt <= until
  return {
    requested,
    run: () =>
      scanEmailCandidates(
        {
          links: {
            listByUser: async () => [link],
            listByMailbox: async (): Promise<EmailBankLink[]> => [link],
            findById: async () => link,
            create: async () => link,
            update: async () => link,
            delete: async () => {},
          },
          mail: {
            listMessagesSince: async (_id: string, since: Date, until: Date, senders: string[]) => {
              requested.push(since)
              return messages.filter((m) => inRange(m, since, until, senders))
            },
            lastMessageDate: async (_id: string, senders: string[], since: Date, until: Date) => {
              const t = messages.filter((m) => inRange(m, since, until, senders)).map((m) => m.receivedAt.getTime())
              return t.length ? new Date(Math.max(...t)) : null
            },
            startDelta: async () => "delta",
            runDelta: async () => ({ messages: [], deltaLink: "delta" }),
            fetchMessage: async () => null,
            ensureSubscription: async () => null,
            deleteSubscription: async () => {},
          },
        } as unknown as Parameters<typeof scanEmailCandidates>[0],
        "user-1",
        "link-1",
        { now: new Date("2026-07-20T12:00:00Z") }
      ),
  }
}

test("la primera importación al conectar un banco trae los avisos de los últimos 3 meses: desde el 1 de abril si se conecta el 14 de julio", async () => {
  assert.equal(SCAN_LOOKBACK_MONTHS, 3)
  const s = scan([
    message("fuera", "2026-03-31T23:59:59Z"), // justo antes del límite: no entra
    message("borde", "2026-04-01T00:00:00Z"), // en el límite: entra
    message("junio", "2026-06-10T15:00:00Z"),
    message("julio", "2026-07-14T10:00:00Z"),
    message("despues", "2026-07-14T13:00:00Z"), // después de conectar: no es de la carga inicial
  ])
  const result = await s.run()
  assert.equal(result.since, "2026-04-01T00:00:00.000Z")
  assert.equal(result.totalMessages, 3)
  assert.ok(s.requested.every((d) => d.getTime() >= Date.parse("2026-04-01T00:00:00Z")))

})

test("un banco poco usado: si los 3 meses no traen movimientos, la ventana baja al mes del último aviso, hasta 6 meses antes de conectar", async () => {
  // Último cargo hace 4 meses (15 de marzo, conectando el 14 de julio): igual ofrece qué confirmar.
  const marzo = await scan([message("marzo", "2026-03-15T12:00:00Z")]).run()
  assert.equal(marzo.since, "2026-03-01T00:00:00.000Z")
  assert.equal(marzo.totalMessages, 1)
  assert.equal(marzo.candidates.length, 1)

  // Borde: más viejo que 6 meses (antes del 1 de enero) no se va a buscar; queda la ventana de 3 meses, vacía.
  const viejo = await scan([message("diciembre", "2025-12-20T12:00:00Z")]).run()
  assert.equal(viejo.since, "2026-04-01T00:00:00.000Z")
  assert.equal(viejo.totalMessages, 0)
})
