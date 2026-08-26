// Contrato de un proveedor de correo y el enrutado por proveedor. PURO a propósito: no importa
// adapters ni el cliente de Prisma, así que se puede probar sin base ni red. El catálogo concreto
// (quién es Outlook, quién Gmail) y la lectura del buzón viven en `provider-registry.ts`.
import type { BankMailProvider } from "../../../domain/finance/email-connection.domain.ts"

// Lo que las rutas necesitan del OAuth de un proveedor, sin nombrar al proveedor.
export type EmailOAuthModule = {
  // ¿El servidor tiene las credenciales de este proveedor? Si no, no se ofrece en la UI.
  isConfigured: () => boolean
  // URL de autorización + verifier PKCE que la ruta guarda en la cookie httpOnly.
  authorization: (state: string) => {
    url: string
    pkceVerifier: string
    secureCookie: boolean
  }
  // Canje del código. Solo devuelve lo que el callback persiste; los access token no salen de acá.
  exchangeCode: (
    code: string,
    pkceVerifier: string
  ) => Promise<{ refreshToken: string | null; emailAddress: string | null }>
}

export type EmailProviderDefinition = {
  key: string // se persiste en email_mailbox.emailProvider; cambiarla rompería los buzones ya creados
  name: string // nombre visible en la UI
  oauth: EmailOAuthModule
  mail: BankMailProvider
}

export type EmailProviderRegistry = readonly EmailProviderDefinition[]

// Proveedor de una clave. Lanza si no existe: hablar con un buzón usando el adapter de otro
// proveedor sería peor que fallar.
export function emailProviderByKey(
  key: string,
  registry: EmailProviderRegistry
): EmailProviderDefinition {
  const provider = registry.find((p) => p.key === key)
  if (!provider) throw new UnknownEmailProviderError(key)
  return provider
}

// Lo que /status le entrega a la UI: todos los proveedores del catálogo con si el servidor los
// tiene configurados. La UI ofrece solo los configurados, pero ve los demás para poder nombrarlos.
export function availableEmailProviders(
  registry: EmailProviderRegistry
): { key: string; name: string; configured: boolean }[] {
  return registry.map((p) => ({
    key: p.key,
    name: p.name,
    configured: p.oauth.isConfigured(),
  }))
}

// Router del port `BankMailProvider`: lee de qué proveedor es el buzón y delega en su adapter. Es
// lo que se inyecta en los use-cases, así que ellos siguen viendo un solo proveedor de correo y no
// se enteran de que hay varios.
//
// Funciona sin discriminador nuevo porque todos los métodos del port ya reciben `mailboxId` como
// primer argumento: el buzón es el que sabe de qué proveedor es.
export function makeMailRouter(
  providerKeyOf: (mailboxId: string) => Promise<string>,
  registry: EmailProviderRegistry
): BankMailProvider {
  const mailFor = async (mailboxId: string) =>
    emailProviderByKey(await providerKeyOf(mailboxId), registry).mail

  return {
    async listMessagesSince(mailboxId, since, until, senders) {
      const mail = await mailFor(mailboxId)
      return mail.listMessagesSince(mailboxId, since, until, senders)
    },
    async lastMessageDate(mailboxId, senders, since, until) {
      const mail = await mailFor(mailboxId)
      return mail.lastMessageDate(mailboxId, senders, since, until)
    },
    async startDelta(mailboxId, since) {
      const mail = await mailFor(mailboxId)
      return mail.startDelta(mailboxId, since)
    },
    async runDelta(mailboxId, deltaLink) {
      const mail = await mailFor(mailboxId)
      return mail.runDelta(mailboxId, deltaLink)
    },
    async fetchMessage(mailboxId, messageId) {
      const mail = await mailFor(mailboxId)
      return mail.fetchMessage(mailboxId, messageId)
    },
    async ensureSubscription(mailboxId) {
      const mail = await mailFor(mailboxId)
      return mail.ensureSubscription(mailboxId)
    },
    async deleteSubscription(mailboxId) {
      const mail = await mailFor(mailboxId)
      return mail.deleteSubscription(mailboxId)
    },
  }
}

export class UnknownEmailProviderError extends Error {
  constructor(key: string) {
    super(`Proveedor de correo no soportado: ${key}`)
    this.name = "UnknownEmailProviderError"
  }
}
