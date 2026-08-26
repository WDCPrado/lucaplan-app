// Catálogo concreto de proveedores de correo y su cableado: cada entrada junta la clave que se
// persiste en `email_mailbox.emailProvider` con su módulo OAuth y su adapter del port
// `BankMailProvider`. Agregar un proveedor es agregar una entrada acá más sus dos archivos.
//
// Las rutas piden el proveedor por clave y NUNCA importan el de uno concreto: eso es lo que permite
// una sola ruta de /connect y una sola de /callback para todos. Los módulos de cada proveedor no
// importan este archivo (la entrada se arma acá), así que no hay ciclo de imports.
//
// El contrato y el enrutado en sí son puros y viven en `providers.ts`; acá se les pasa el catálogo.
import type { BankMailProvider } from "../../../domain/finance/email-connection.domain.ts"
import { EmailConnectionNotFoundError } from "../../../domain/finance/email-connection.domain.ts"
import { prisma } from "../../database/prisma/client.ts"
import { msgraphMailProvider } from "../outlook/msgraph.provider.ts"
import { outlookOAuth } from "../outlook/outlook-oauth.ts"
import {
  availableEmailProviders,
  emailProviderByKey,
  makeMailRouter,
  type EmailProviderDefinition,
  type EmailProviderRegistry,
} from "./providers.ts"

export const OUTLOOK: EmailProviderDefinition = {
  key: "outlook",
  name: "Outlook",
  notConfiguredError:
    "Outlook no está configurado en el servidor (falta OUTLOOK_CLIENT_ID)",
  oauth: outlookOAuth,
  mail: msgraphMailProvider,
}

export const EMAIL_PROVIDER_REGISTRY: EmailProviderRegistry = [OUTLOOK]

// Proveedor por defecto cuando la petición no dice cuál. Sostiene a los buzones creados antes de
// que la conexión distinguiera proveedores: su columna quedó en "outlook" por el default de la
// tabla, que es exactamente lo que eran.
export const DEFAULT_EMAIL_PROVIDER = OUTLOOK.key

// Los mismos helpers de `providers.ts`, ya atados al catálogo real.
export function emailProvider(key: string): EmailProviderDefinition {
  return emailProviderByKey(key, EMAIL_PROVIDER_REGISTRY)
}

export function emailProviders() {
  return availableEmailProviders(EMAIL_PROVIDER_REGISTRY)
}

// Clave del proveedor de un buzón, por PK.
async function providerKeyFromDb(mailboxId: string): Promise<string> {
  const row = await prisma.emailMailbox.findUnique({
    where: { id: mailboxId },
    select: { emailProvider: true },
  })
  if (!row) throw new EmailConnectionNotFoundError()
  return row.emailProvider
}

// Un router NUEVO por operación (una petición, un lote de webhook, una pasada del cron). Su caché
// de proveedores vive lo que vive el router: dentro de la operación no repite la consulta, y entre
// operaciones no puede quedar vieja si el buzón se reconectó por otro proveedor. Por eso no hay un
// singleton de módulo — sería una caché de por vida del proceso.
export function makeEmailMailRouter(): BankMailProvider {
  return makeMailRouter(providerKeyFromDb, EMAIL_PROVIDER_REGISTRY)
}
