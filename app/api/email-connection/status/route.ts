// Estado de la conexión por correo del usuario, en dos niveles: los correos conectados y, dentro de
// cada uno, sus bancos con etiqueta, fase del setup, fecha del snapshot vigente y conteo de
// omitidos. Sin tokens ni contenido de correo.
//
// `providers` es el catálogo con si el servidor tiene credenciales de cada uno: la UI ofrece
// conectar solo los configurados, y nombra el proveedor de cada buzón ya conectado.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { getEmailConnectionView } from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import {
  emailBankLinkRepository,
  emailMailboxRepository,
} from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"
import { emailProviders } from "@/arch/v1/infrastructure/http/email/provider-registry"

export async function GET(req: Request) {
  return withUser(req, async (userId) => {
    const view = await getEmailConnectionView(
      { mailboxes: emailMailboxRepository, links: emailBankLinkRepository },
      userId
    )
    return { providers: emailProviders(), ...view }
  })
}
