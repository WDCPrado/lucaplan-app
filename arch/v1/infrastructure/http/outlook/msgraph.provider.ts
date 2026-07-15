// Adapter de Microsoft Graph que implementa el port BankMailProvider. `fetch` nativo, sin SDK.
// Los tokens viven SOLO aquí: el refresh token se lee cifrado de la DB, se rota si Microsoft
// entrega uno nuevo y el access token se cachea en memoria por conexión. Los cuerpos de correo se
// devuelven en memoria al caller y nunca se persisten ni se registran.
import { prisma } from "../../database/prisma/client.ts"
import {
  EmailConnectionNotFoundError,
  type BankEmailMessage,
  type BankMailProvider,
} from "../../../domain/finance/email-connection.domain.ts"
import {
  decryptSecret,
  deriveVerifier,
  encryptSecret,
  EMAIL_PURPOSE,
} from "../bancochile/crypto.ts"
import { outlookConfig, refreshTokens } from "./outlook-oauth.ts"

const GRAPH = "https://graph.microsoft.com/v1.0"
const MESSAGE_SELECT = "id,subject,from,receivedDateTime,internetMessageId,body"
const PAGE_SIZE = 50
const MAX_PAGES = 40 // tope duro por sync (40×50 = 2000 mensajes; volumen personal sobra)
const SUBSCRIPTION_LIFETIME_MS = 2 * 24 * 60 * 60 * 1000 // 2 días (< límite de Outlook); se renueva a diario

// clientState del webhook: DERIVADO del secreto maestro + id de conexión (no se guarda en la DB;
// se re-deriva para crear la suscripción y para verificar cada notificación).
export function graphClientState(connectionId: string): string {
  return deriveVerifier(`${EMAIL_PURPOSE}:client-state`, connectionId)
}

// --- Access token por conexión (cache en memoria; rotación del refresh token persistida) ---

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

async function accessTokenFor(connectionId: string): Promise<string> {
  const cached = tokenCache.get(connectionId)
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token

  const row = await prisma.emailConnection.findUnique({
    where: { id: connectionId },
  })
  if (!row) throw new EmailConnectionNotFoundError()
  const refreshToken = decryptSecret(
    row.refreshTokenEnc,
    row.refreshTokenIv,
    EMAIL_PURPOSE
  )
  const tokens = await refreshTokens(outlookConfig(), refreshToken) // EmailReauthRequiredError si fue revocado
  if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
    const { enc, iv } = encryptSecret(tokens.refreshToken, EMAIL_PURPOSE)
    await prisma.emailConnection.update({
      where: { id: connectionId },
      data: { refreshTokenEnc: enc, refreshTokenIv: iv },
    })
  }
  tokenCache.set(connectionId, {
    token: tokens.accessToken,
    expiresAt: tokens.expiresAt.getTime(),
  })
  return tokens.accessToken
}

// GET/POST/PATCH/DELETE autenticado contra Graph. Ante 401 reintenta UNA vez con token fresco.
async function graphFetch(
  connectionId: string,
  url: string,
  init: RequestInit = {},
  retried = false
): Promise<Response> {
  const token = await accessTokenFor(connectionId)
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      // El parser trabaja sobre HTML; pedirlo explícito evita variantes de texto plano.
      prefer: 'outlook.body-content-type="html"',
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  })
  if (res.status === 401 && !retried) {
    tokenCache.delete(connectionId)
    return graphFetch(connectionId, url, init, true)
  }
  return res
}

async function graphJson<T>(
  connectionId: string,
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await graphFetch(connectionId, url, init)
  if (!res.ok) {
    throw new Error(`Microsoft Graph respondió ${res.status}`)
  }
  return (await res.json()) as T
}

// --- Mapeo Graph → dominio ---

type GraphMessage = {
  id: string
  subject?: string
  internetMessageId?: string
  receivedDateTime?: string
  from?: { emailAddress?: { address?: string } }
  body?: { content?: string }
  "@removed"?: { reason: string }
}

function toBankEmailMessage(m: GraphMessage): BankEmailMessage {
  return {
    id: m.id,
    internetMessageId: m.internetMessageId ?? null,
    from: m.from?.emailAddress?.address ?? "",
    subject: m.subject ?? "",
    receivedAt: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(0),
    htmlBody: m.body?.content ?? "",
  }
}

type GraphPage = {
  value: GraphMessage[]
  "@odata.nextLink"?: string
  "@odata.deltaLink"?: string
}

// --- Provider ---

export const msgraphMailProvider: BankMailProvider = {
  async listMessagesSince(connectionId, since) {
    const first = new URL(`${GRAPH}/me/mailFolders/inbox/messages`)
    first.searchParams.set(
      "$filter",
      `receivedDateTime ge ${since.toISOString()}`
    )
    first.searchParams.set("$select", MESSAGE_SELECT)
    first.searchParams.set("$top", String(PAGE_SIZE))
    const messages: BankEmailMessage[] = []
    let url: string | undefined = first.toString()
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const data: GraphPage = await graphJson<GraphPage>(connectionId, url)
      messages.push(...data.value.map(toBankEmailMessage))
      url = data["@odata.nextLink"]
    }
    return messages
  },

  async startDelta(connectionId, since) {
    // Recorre el delta inicial SIN procesar mensajes (el mes ya se importó por lista) y devuelve el
    // deltaLink final, que representa "cambios desde ahora".
    const first = new URL(`${GRAPH}/me/mailFolders/inbox/messages/delta`)
    first.searchParams.set(
      "$filter",
      `receivedDateTime ge ${since.toISOString()}`
    )
    first.searchParams.set("$select", "id")
    let url: string | undefined = first.toString()
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const data: GraphPage = await graphJson<GraphPage>(connectionId, url)
      if (data["@odata.deltaLink"]) return data["@odata.deltaLink"]
      url = data["@odata.nextLink"]
    }
    throw new Error("Graph no entregó deltaLink para el Inbox")
  },

  async runDelta(connectionId, deltaLink) {
    // El delta trae ids (y cambios de estado); el mensaje completo se pide aparte. Los repetidos no
    // duplican: la importación es idempotente por identidad externa.
    const ids: string[] = []
    let url: string | undefined = deltaLink
    let nextDelta = deltaLink
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const data: GraphPage = await graphJson<GraphPage>(connectionId, url)
      for (const item of data.value)
        if (!item["@removed"] && item.id) ids.push(item.id)
      if (data["@odata.deltaLink"]) {
        nextDelta = data["@odata.deltaLink"]
        url = undefined
      } else {
        url = data["@odata.nextLink"]
      }
    }
    const messages: BankEmailMessage[] = []
    for (const id of ids) {
      const msg = await this.fetchMessage(connectionId, id)
      if (msg) messages.push(msg)
    }
    return { messages, deltaLink: nextDelta }
  },

  async fetchMessage(connectionId, messageId) {
    const url = new URL(`${GRAPH}/me/messages/${encodeURIComponent(messageId)}`)
    url.searchParams.set("$select", MESSAGE_SELECT)
    const res = await graphFetch(connectionId, url.toString())
    if (res.status === 404) return null
    if (!res.ok)
      throw new Error(
        `Microsoft Graph respondió ${res.status} al leer un mensaje`
      )
    return toBankEmailMessage((await res.json()) as GraphMessage)
  },

  async ensureSubscription(connectionId) {
    const cfg = outlookConfig()
    if (!cfg.webhookUrl) return null // sin URL HTTPS pública no hay webhook (OAuth/delta siguen operando)
    const expiresAt = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MS)
    const row = await prisma.emailConnection.findUnique({
      where: { id: connectionId },
    })
    if (!row) throw new EmailConnectionNotFoundError()

    if (row.subscriptionId) {
      const res = await graphFetch(
        connectionId,
        `${GRAPH}/subscriptions/${encodeURIComponent(row.subscriptionId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ expirationDateTime: expiresAt.toISOString() }),
        }
      )
      if (res.ok) return { subscriptionId: row.subscriptionId, expiresAt }
      // Expiró o fue eliminada: se crea una nueva (abajo). Otros errores sí se propagan.
      if (res.status !== 404) {
        throw new Error(`No se pudo renovar la suscripción (${res.status})`)
      }
    }

    const created = await graphJson<{ id: string; expirationDateTime: string }>(
      connectionId,
      `${GRAPH}/subscriptions`,
      {
        method: "POST",
        body: JSON.stringify({
          changeType: "created",
          notificationUrl: cfg.webhookUrl,
          resource: "me/mailFolders('inbox')/messages",
          expirationDateTime: expiresAt.toISOString(),
          clientState: graphClientState(connectionId),
        }),
      }
    )
    return {
      subscriptionId: created.id,
      expiresAt: new Date(created.expirationDateTime),
    }
  },

  async deleteSubscription(connectionId) {
    const row = await prisma.emailConnection.findUnique({
      where: { id: connectionId },
    })
    if (!row?.subscriptionId) return
    await graphFetch(
      connectionId,
      `${GRAPH}/subscriptions/${encodeURIComponent(row.subscriptionId)}`,
      {
        method: "DELETE",
      }
    ).catch(() => {})
  },
}
