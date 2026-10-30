// Dominio de la conexión bancaria por CORREO (Outlook → bancos del catálogo). Puro: tipos + ports +
// errores. La conexión lee notificaciones de correo con permiso mínimo de lectura y alimenta el
// mismo modelo financiero (Bank → FinancialAccount → Card → BalanceBucket → Transaction). Los
// saldos resultantes son PROYECCIONES desde un snapshot manual, nunca saldos reportados por el
// banco.
//
// Dos entidades con ciclos de vida distintos:
// - BUZÓN: la autorización de un correo. Un token, un estado delta y una suscripción, sin importar
//   cuántos bancos alimente.
// - VÍNCULO: lo que ese buzón alimenta en un banco concreto (snapshot, omitidos, setup). Un buzón
//   tiene N vínculos; un banco puede venir de N buzones, pero nunca dos veces del mismo buzón.

// --- Enums / tipos base ---

export const CONNECTION_METHODS = ["email"] as const
export type ConnectionMethod = (typeof CONNECTION_METHODS)[number]

// Estado de la AUTORIZACIÓN del buzón. El setup de cada banco vive en su vínculo.
export const EMAIL_MAILBOX_STATUSES = [
  "active", // autorizado; sincronización corriendo
  "reauth_required", // Microsoft rechazó la renovación del token; se conservan los datos
  "error", // error operativo (suscripción, delta); el refresco manual puede recuperar
] as const
export type EmailMailboxStatus = (typeof EMAIL_MAILBOX_STATUSES)[number]

export const EMAIL_LINK_STATUSES = [
  "pending_setup", // falta validar candidatos y snapshot (no hay datos financieros aún)
  "active", // banco creado; importación e incremental corriendo
] as const
export type EmailLinkStatus = (typeof EMAIL_LINK_STATUSES)[number]

// Buzón persistido. NUNCA expone tokens: el refresh token vive cifrado en la fila y solo la
// infraestructura lo descifra para hablar con Microsoft.
export type EmailMailbox = {
  id: string
  userId: string
  emailProvider: string // clave del proveedor en el catálogo ("outlook", …)
  emailAddress: string
  status: EmailMailboxStatus
  createdAt: Date
  deltaLink: string | null // estado delta de Graph (recuperación incremental)
  subscriptionId: string | null
  subscriptionExpiresAt: Date | null
  lastSyncedAt: Date | null
  lastError: string | null // sin PII ni tokens
  discardedCount: number // correos que ningún banco del catálogo reclama (conteo, sin contenido)
}

// Vínculo entre un buzón y un banco.
export type EmailBankLink = {
  id: string
  mailboxId: string
  userId: string
  bankProvider: string // clave del banco en el catálogo
  label: string | null // distingue este origen ("Empresa"); obligatoria desde el 2º vínculo del banco
  bankId: string | null // banco creado tras validar candidatos; null durante el setup
  status: EmailLinkStatus
  createdAt: Date // fija el cierre de la carga inicial de este banco
  skippedCount: number // correos de ESTE banco que no pudieron convertirse en movimiento
  lastBalanceReconciledAt: Date | null // snapshot manual vigente; la proyección parte aquí
}

// Un vínculo junto a su buzón: lo que necesitan los use-cases que operan sobre un banco concreto.
export type EmailBankLinkWithMailbox = EmailBankLink & { mailbox: EmailMailbox }

// Mensaje de correo tal como lo entrega el proveedor. El cuerpo HTML se usa SOLO en memoria para
// extraer el evento; jamás se persiste ni se registra en logs.
export type BankEmailMessage = {
  id: string // id inmutable del mensaje en Graph
  internetMessageId: string | null // RFC 5322 Message-ID (identidad estable preferida)
  from: string // dirección del remitente
  subject: string
  receivedAt: Date
  htmlBody: string
}

// --- Ports ---

// Proveedor de correo (Microsoft Graph). La infraestructura resuelve tokens internamente por
// mailboxId; la aplicación nunca ve credenciales. Todos los métodos pueden lanzar
// EmailReauthRequiredError si Microsoft rechaza la renovación del token.
export interface BankMailProvider {
  // Mensajes del Inbox desde `since` hasta ahora, o hasta `until` si se acota (paginación interna).
  // Acotar importa cuando la ventana es un mes viejo: sin `until` se traería todo lo posterior, que
  // además puede truncarse contra el tope de páginas y perder justo los correos buscados.
  //
  // `senders` acota a esos remitentes DEL LADO DEL PROVEEDOR. Con él, el setup de un banco baja de
  // "todo el buzón de ese mes, con cuerpos" a "los avisos de ese banco": en un buzón real la
  // diferencia es de miles de correos a unos pocos. Se omite en la sincronización, donde una pasada
  // trae todo el correo nuevo para repartirlo entre los bancos del buzón.
  listMessagesSince(
    mailboxId: string,
    since: Date,
    until?: Date,
    senders?: string[]
  ): Promise<BankEmailMessage[]>
  // Fecha del mensaje más reciente de esos remitentes dentro de [since, until]; null si no hay.
  // Solo la fecha: NO descarga cuerpos. Sirve para ubicar qué mes escanear sin traerse el buzón.
  lastMessageDate(
    mailboxId: string,
    senders: string[],
    since: Date,
    until: Date
  ): Promise<Date | null>
  // Inicializa el estado delta del Inbox desde `since`; devuelve el deltaLink para la próxima sync.
  startDelta(mailboxId: string, since: Date): Promise<string>
  // Ejecuta el delta guardado; EmailDeltaExpiredError exige una relectura antes de avanzar.
  runDelta(
    mailboxId: string,
    deltaLink: string
  ): Promise<{ messages: BankEmailMessage[]; deltaLink: string }>
  // Mensaje puntual (webhook: la notificación solo trae el id). Null si ya no existe.
  fetchMessage(
    mailboxId: string,
    messageId: string
  ): Promise<BankEmailMessage | null>
  // Crea o renueva la suscripción webhook. Null si no hay URL pública configurada (modo local).
  ensureSubscription(
    mailboxId: string
  ): Promise<{ subscriptionId: string; expiresAt: Date } | null>
  // Elimina la suscripción (best-effort al desconectar).
  deleteSubscription(mailboxId: string): Promise<void>
}

export type NewEmailMailbox = {
  userId: string
  emailProvider: string
  emailAddress: string
  refreshToken: string // en claro solo en tránsito server-side; el repo lo persiste cifrado
}

export type EmailMailboxPatch = Partial<{
  emailProvider: string // reconectar por otro proveedor no puede dejar la fila mintiendo
  refreshToken: string // rotación: el proveedor puede devolver uno nuevo en cada refresh
  status: EmailMailboxStatus
  deltaLink: string | null
  subscriptionId: string | null
  subscriptionExpiresAt: Date | null
  lastSyncedAt: Date | null
  lastError: string | null
  discardedCount: number
}>

export interface EmailMailboxRepository {
  listByUser(userId: string): Promise<EmailMailbox[]>
  findById(id: string): Promise<EmailMailbox | null>
  findByAddress(
    userId: string,
    emailAddress: string
  ): Promise<EmailMailbox | null>
  // Webhook: localiza el buzón dueño de la suscripción notificada. Null si no existe.
  findBySubscriptionId(subscriptionId: string): Promise<EmailMailbox | null>
  // Buzones cuya suscripción vence antes de `before` (renovación programada).
  listForSubscriptionRenewal(before: Date): Promise<EmailMailbox[]>
  create(input: NewEmailMailbox): Promise<EmailMailbox>
  update(id: string, patch: EmailMailboxPatch): Promise<EmailMailbox>
  delete(id: string): Promise<void>
}

export type NewEmailBankLink = {
  mailboxId: string
  userId: string
  bankProvider: string
  label: string | null
}

export type EmailBankLinkPatch = Partial<{
  label: string | null
  bankId: string | null
  status: EmailLinkStatus
  skippedCount: number
  lastBalanceReconciledAt: Date | null
}>

export interface EmailBankLinkRepository {
  listByUser(userId: string): Promise<EmailBankLinkWithMailbox[]>
  listByMailbox(mailboxId: string): Promise<EmailBankLink[]>
  findById(id: string): Promise<EmailBankLinkWithMailbox | null>
  create(input: NewEmailBankLink): Promise<EmailBankLink>
  update(id: string, patch: EmailBankLinkPatch): Promise<EmailBankLink>
  delete(id: string): Promise<void>
}

// Método de conexión activo por (usuario, banco, buzón). `claim` es atómico: si otro método ya está
// activo lanza ConnectionMethodConflictError; la unicidad de DB respalda la regla ante carreras.
export interface ConnectionMethodRepository {
  activeMethod(
    userId: string,
    bankProvider: string,
    mailboxId: string
  ): Promise<ConnectionMethod | null>
  claim(
    userId: string,
    bankProvider: string,
    mailboxId: string,
    method: ConnectionMethod
  ): Promise<void>
  // Libera el método solo si es el vigente.
  release(
    userId: string,
    bankProvider: string,
    mailboxId: string,
    method: ConnectionMethod
  ): Promise<void>
}

// --- Errores de negocio ---

export class EmailDeltaExpiredError extends Error {
  constructor() {
    super("El estado incremental del correo expiró; hay que reconstruirlo.")
    this.name = "EmailDeltaExpiredError"
  }
}

// Ya existe otro método de conexión activo para ese banco desde ese buzón (→ 409).
export class ConnectionMethodConflictError extends Error {
  constructor(bankName = "Ese banco") {
    super(
      `${bankName} ya está conectado desde este correo. Desconéctalo primero para volver a conectar.`
    )
    this.name = "ConnectionMethodConflictError"
  }
}

// El banco ya tiene un vínculo en ese mismo buzón: el enrutado por remitente no podría decidir a
// cuál imputar el movimiento (→ 409). Repetirlo exige otro correo.
export class BankAlreadyLinkedError extends Error {
  constructor(bankName = "Ese banco") {
    super(
      `${bankName} ya está conectado desde este correo. Para tenerlo dos veces, conéctalo desde otro correo.`
    )
    this.name = "BankAlreadyLinkedError"
  }
}

// Falta la etiqueta que distingue este vínculo de otro del mismo banco (→ 422).
export class BankLabelRequiredError extends Error {
  constructor(bankName = "Ese banco") {
    super(
      `${bankName} ya está conectado desde otro correo: ponle una etiqueta para distinguirlos (por ejemplo, "Empresa").`
    )
    this.name = "BankLabelRequiredError"
  }
}

// No existe el buzón o el vínculo pedido (→ 404).
export class EmailConnectionNotFoundError extends Error {
  constructor(message = "No hay una conexión de correo configurada") {
    super(message)
    this.name = "EmailConnectionNotFoundError"
  }
}

// La autorización de Microsoft fue revocada o expiró: hay que reconectar (→ 422). Los datos
// financieros existentes se conservan.
export class EmailReauthRequiredError extends Error {
  constructor() {
    super(
      "La autorización de Outlook expiró o fue revocada. Reconecta tu cuenta."
    )
    this.name = "EmailReauthRequiredError"
  }
}

// El estado OAuth del callback es inválido, expiró o no corresponde al usuario (→ 401).
export class OAuthStateError extends Error {
  constructor() {
    super("Estado OAuth inválido o expirado")
    this.name = "OAuthStateError"
  }
}

// La operación no corresponde al estado del setup (ej. confirmar sin vínculo pendiente) (→ 422).
export class EmailSetupStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EmailSetupStateError"
  }
}
