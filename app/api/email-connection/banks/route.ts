// Agregar un banco a un correo YA autorizado: no pasa por OAuth (el buzón conserva su
// autorización). Rechaza repetir el mismo banco en ese correo y exige etiqueta si ese banco ya
// viene de otro correo.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { addBankLink } from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import { makeEmailConnectionDeps } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    mailboxId?: string
    bankProvider?: string
    label?: string
  }
  return withUser(
    req,
    async (userId) => {
      const link = await addBankLink(makeEmailConnectionDeps(), userId, {
        mailboxId: String(body.mailboxId ?? ""),
        bankProvider: String(body.bankProvider ?? ""),
        label: body.label ?? null,
      })
      return { id: link.id }
    },
    201
  )
}
