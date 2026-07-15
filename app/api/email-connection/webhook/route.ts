// Webhook público de Microsoft Graph. Dos modos:
//  1) Validación: Microsoft manda `validationToken` por query y espera el token en texto plano.
//  2) Notificación: cada item se acepta SOLO si su subscription pertenece a una conexión activa y
//     su `clientState` coincide con el derivado server-side; recién entonces se recupera el mensaje
//     desde Graph y se procesa. Una notificación inválida no lee correo ni toca datos.
// El procesamiento se serializa por conexión y es idempotente (webhook repetido no duplica).
import { timingSafeEqual } from "node:crypto"
import { withLock, LockBusyError } from "@/arch/shared/mutex"
import type { BankEmailMessage } from "@/arch/v1/domain/finance/email-connection.domain"
import {
  findWebhookConnection,
  syncEmailConnection,
} from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import { makeEmailConnectionDeps } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"
import { graphClientState } from "@/arch/v1/infrastructure/http/outlook/msgraph.provider"

type GraphNotification = {
  subscriptionId?: string
  clientState?: string
  resourceData?: { id?: string }
}

function sameSecret(a: string, b: string): boolean {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  )
}

export async function POST(req: Request) {
  // Handshake de validación de la suscripción: responder el token en texto plano, rápido.
  const validationToken = new URL(req.url).searchParams.get("validationToken")
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "content-type": "text/plain" },
    })
  }

  if (Number(req.headers.get("content-length") ?? 0) > 1_000_000)
    return new Response(null, { status: 413 })
  const body = (await req.json().catch(() => null)) as {
    value?: GraphNotification[]
  } | null
  const notifications = (body?.value ?? []).slice(0, 100)
  const deps = makeEmailConnectionDeps()

  // Mensajes válidos agrupados por conexión (verificación de clientState ANTES de leer correo).
  const byConnection = new Map<
    string,
    { userId: string; messageIds: string[] }
  >()
  for (const n of notifications) {
    if (!n.subscriptionId || !n.clientState || !n.resourceData?.id) continue
    const conn = await findWebhookConnection(deps, n.subscriptionId)
    if (
      !conn ||
      conn.status !== "active" ||
      !conn.bankId ||
      !sameSecret(graphClientState(conn.id), n.clientState)
    )
      continue
    const entry = byConnection.get(conn.id) ?? {
      userId: conn.userId,
      messageIds: [],
    }
    entry.messageIds.push(n.resourceData.id)
    byConnection.set(conn.id, entry)
  }

  // Volumen personal: se procesa en línea (serializado por usuario) y se acusa recibo. Si la
  // conexión está ocupada, el delta periódico/manual recupera el mensaje después.
  for (const [connectionId, { userId, messageIds }] of byConnection) {
    try {
      await withLock(`email:${userId}`, async () => {
        const messages: BankEmailMessage[] = []
        for (const id of messageIds) {
          const msg = await deps.mail.fetchMessage(connectionId, id)
          if (msg) messages.push(msg)
        }
        if (messages.length > 0)
          await syncEmailConnection(deps, userId, { messages })
      })
    } catch (e) {
      if (!(e instanceof LockBusyError)) {
        console.error(
          "[email-connection] webhook no pudo procesar una notificación:",
          (e as Error).name
        )
      }
    }
  }

  return new Response(null, { status: 202 })
}
