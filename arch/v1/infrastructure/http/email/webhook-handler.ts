import { timingSafeEqual } from "node:crypto"
import type { EmailMailbox, EmailMailboxRepository } from "../../../domain/finance/email-connection.domain.ts"

type WebhookDeps = {
  mailboxes: Pick<EmailMailboxRepository, "findBySubscriptionId">
  clientState: (mailboxId: string) => string
  process: (mailbox: EmailMailbox, ids: string[]) => Promise<void>
  // Corre el trabajo después de responder. Graph corta a los pocos segundos: procesar antes de
  // acusar recibo (importar, categorizar, avisar) lo hacía cortar y reintentar en vez de entregar.
  defer: (work: () => Promise<void>, mailboxId: string) => void
}

function sameSecret(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export async function handleEmailWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const validationToken = new URL(req.url).searchParams.get("validationToken")
  if (validationToken) return new Response(validationToken, { headers: { "content-type": "text/plain" } })
  if (Number(req.headers.get("content-length") ?? 0) > 1_000_000) return new Response(null, { status: 413 })
  const body = await req.json().catch(() => null)
  if (!Array.isArray(body?.value)) return new Response(null, { status: 400 })
  // No acusar recibo de un lote truncado: sus mensajes restantes se perderían.
  if (body.value.length > 100) return new Response(null, { status: 413 })
  const grouped = new Map<string, { mailbox: EmailMailbox; ids: string[] }>()
  try {
    for (const n of body.value) {
      if (!n || typeof n.subscriptionId !== "string" || typeof n.clientState !== "string" || typeof n.resourceData?.id !== "string") continue
      const mailbox = await deps.mailboxes.findBySubscriptionId(n.subscriptionId)
      if (!mailbox || !sameSecret(deps.clientState(mailbox.id), n.clientState)) continue
      const entry = grouped.get(mailbox.id) ?? { mailbox, ids: [] }
      entry.ids.push(n.resourceData.id)
      grouped.set(mailbox.id, entry)
    }
  } catch {
    return new Response(null, { status: 503 })
  }
  for (const { mailbox, ids } of grouped.values()) {
    // Autorización revocada: el aviso ya está guardado; no volver a pedir tokens.
    if (mailbox.status === "reauth_required") continue
    // Un fallo después del 202 deja el buzón en error y no avanza el delta: «Sincronizar» lo recupera.
    deps.defer(() => deps.process(mailbox, ids), mailbox.id)
  }
  return new Response(null, { status: 202 })
}
