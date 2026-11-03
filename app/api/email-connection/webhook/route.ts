import { withLock } from "@/arch/shared/mutex"
import { syncWebhookMessages } from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import { makeEmailConnectionDeps } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"
import { graphClientState } from "@/arch/v1/infrastructure/http/outlook/msgraph.provider"
import { handleEmailWebhook } from "@/arch/v1/infrastructure/http/email/webhook-handler"

export async function POST(req: Request) {
  const deps = makeEmailConnectionDeps()
  return handleEmailWebhook(req, {
    mailboxes: deps.mailboxes,
    clientState: graphClientState,
    process: (mailbox, ids) => withLock(`email:${mailbox.userId}`, () => syncWebhookMessages(deps, mailbox, ids)),
  })
}
