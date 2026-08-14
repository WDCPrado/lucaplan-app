// Desconexión en dos niveles. Con `linkId` (o `bankId`, que la UI de una cuenta sí conoce)
// desconecta UN banco: borra su banco con las cuentas y movimientos (cascade) y libera su método;
// los demás bancos del mismo correo siguen vivos, y si era el último se va también el buzón con su
// suscripción y sus tokens. Con `mailboxId` desconecta el correo completo. GET describe qué se
// perderá, para confirmarlo informado.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { EmailSetupStateError } from "@/arch/v1/domain/finance/email-connection.domain"
import {
  describeBankRemoval,
  disconnectBankById,
  disconnectBankLink,
  disconnectMailbox,
} from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import { makeEmailConnectionDeps } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"

export async function GET(req: Request) {
  const linkId = new URL(req.url).searchParams.get("link") ?? ""
  return withUser(req, (userId) =>
    describeBankRemoval(makeEmailConnectionDeps(), userId, linkId)
  )
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    linkId?: string
    bankId?: string
    mailboxId?: string
  }
  return withUser(req, async (userId) => {
    const deps = makeEmailConnectionDeps()
    if (body.linkId) await disconnectBankLink(deps, userId, body.linkId)
    else if (body.bankId) await disconnectBankById(deps, userId, body.bankId)
    else if (body.mailboxId)
      await disconnectMailbox(deps, userId, body.mailboxId)
    // Sin identificador NO se desconecta nada, así que tampoco puede responder 200: un cliente que
    // solo mire el status cerraría su diálogo como si hubiera funcionado.
    else
      throw new EmailSetupStateError(
        "Indica el banco o el correo a desconectar"
      )
    return { ok: true }
  })
}
