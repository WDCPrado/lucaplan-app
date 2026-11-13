import { after } from "next/server"
import { LockBusyError, withLockWaiting } from "@/arch/shared/mutex"
import { markSyncError, syncWebhookMessages } from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import { makeEmailConnectionDeps } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"
import { graphClientState } from "@/arch/v1/infrastructure/http/outlook/msgraph.provider"
import { handleEmailWebhook } from "@/arch/v1/infrastructure/http/email/webhook-handler"

export async function POST(req: Request) {
  const deps = makeEmailConnectionDeps()
  return handleEmailWebhook(req, {
    mailboxes: deps.mailboxes,
    clientState: graphClientState,
    // Espera el lock: los avisos llegan en ráfaga y ya nadie los reintenta. Si aun así sigue ocupado,
    // el aviso se perdería en silencio: se marca el buzón en error para que «Sincronizar» lo recupere.
    process: (mailbox, ids) =>
      withLockWaiting(`email:${mailbox.userId}`, () => syncWebhookMessages(deps, mailbox, ids)).catch(async (e) => {
        if (e instanceof LockBusyError) await markSyncError(deps, mailbox, new Error("sincronización ocupada"))
        throw e
      }),
    // Solo el tipo y el buzón: el mensaje de un error de base o de IA puede traer datos del aviso.
    defer: (work, mailboxId) =>
      after(() => work().catch((e) => console.error("Webhook de correo falló:", (e as Error).name, mailboxId))),
  })
}
