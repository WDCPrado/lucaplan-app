// Dominio de la conexión bancaria por CORREO (Outlook → Banco de Chile). Puro: tipos + ports +
// errores. La conexión lee notificaciones de correo con permiso mínimo de lectura y alimenta el
// mismo modelo financiero (Bank → FinancialAccount → Card → BalanceBucket → Transaction). Los
// saldos resultantes son PROYECCIONES desde un snapshot manual, nunca saldos reportados por el
// banco. Un banco usa `scraper` O `email`, nunca ambos (ver ConnectionMethodRepository).

// --- Enums / tipos base ---

export const CONNECTION_METHODS = ["scraper", "email"] as const
export type ConnectionMethod = (typeof CONNECTION_METHODS)[number]

export const EMAIL_CONNECTION_STATUSES = [
  "pending_setup", // OAuth listo; falta validar candidatos y snapshot (no hay datos financieros aún)
  "active", // banco creado; sincronización incremental corriendo
  "reauth_required", // Microsoft rechazó la renovación del token; se conservan los datos
  "error", // error operativo (suscripción, delta); el refresco manual puede recuperar
] as const
export type EmailConnectionStatus = (typeof EMAIL_CONNECTION_STATUSES)[number]

// Conexión de correo persistida. NUNCA expone tokens: el refresh token vive cifrado en la fila y
// solo la infraestructura lo descifra para hablar con Microsoft Graph.
export type EmailConnection = {
  id: string
  userId: string
  bankProvider: string // "bancochile"
  emailProvider: string // "outlook"
  emailAddress: string
  bankId: string | null // banco creado tras validar candidatos; null durante el setup
  status: EmailConnectionStatus
  createdAt: Date // fija el cierre de la carga inicial al instante del OAuth
  deltaLink: string | null // estado delta de Graph (recuperación incremental)
  subscriptionId: string | null
  subscriptionExpiresAt: Date | null
  lastSyncedAt: Date | null
  lastError: string | null // sin PII ni tokens
  skippedCount: number // mensajes omitidos acumulados (conteo, sin contenido)
  lastBalanceReconciledAt: Date | null // snapshot manual vigente; la proyección parte aquí
}

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
// connectionId; la aplicación nunca ve credenciales. Todos los métodos pueden lanzar
// EmailReauthRequiredError si Microsoft rechaza la renovación del token.
export interface BankMailProvider {
  // Mensajes del Inbox desde `since` hasta ahora (paginación interna).
  listMessagesSince(
    connectionId: string,
    since: Date
  ): Promise<BankEmailMessage[]>
  // Inicializa el estado delta del Inbox desde `since`; devuelve el deltaLink para la próxima sync.
  startDelta(connectionId: string, since: Date): Promise<string>
  // Ejecuta el delta guardado; devuelve mensajes nuevos y el siguiente deltaLink.
  runDelta(
    connectionId: string,
    deltaLink: string
  ): Promise<{ messages: BankEmailMessage[]; deltaLink: string }>
  // Mensaje puntual (webhook: la notificación solo trae el id). Null si ya no existe.
  fetchMessage(
    connectionId: string,
    messageId: string
  ): Promise<BankEmailMessage | null>
  // Crea o renueva la suscripción webhook. Null si no hay URL pública configurada (modo local).
  ensureSubscription(
    connectionId: string
  ): Promise<{ subscriptionId: string; expiresAt: Date } | null>
  // Elimina la suscripción (best-effort al desconectar).
  deleteSubscription(connectionId: string): Promise<void>
}

export type NewEmailConnection = {
  userId: string
  bankProvider: string
  emailProvider: string
  emailAddress: string
  refreshToken: string // en claro solo en tránsito server-side; el repo lo persiste cifrado
}

export type EmailConnectionPatch = Partial<{
  emailAddress: string
  refreshToken: string // rotación: Microsoft devuelve uno nuevo en cada refresh
  bankId: string | null
  status: EmailConnectionStatus
  deltaLink: string | null
  subscriptionId: string | null
  subscriptionExpiresAt: Date | null
  lastSyncedAt: Date | null
  lastError: string | null
  skippedCount: number
  lastBalanceReconciledAt: Date | null
}>

export interface EmailConnectionRepository {
  findByUser(
    userId: string,
    bankProvider: string
  ): Promise<EmailConnection | null>
  findById(id: string): Promise<EmailConnection | null>
  // Webhook: localiza la conexión dueña de la suscripción notificada. Null si no existe.
  findBySubscriptionId(subscriptionId: string): Promise<EmailConnection | null>
  create(input: NewEmailConnection): Promise<EmailConnection>
  update(id: string, patch: EmailConnectionPatch): Promise<EmailConnection>
  delete(id: string): Promise<void>
}

// Método de conexión activo por (usuario, banco). `claim` es atómico: si otro método ya está
// activo lanza ConnectionMethodConflictError; la unicidad de DB respalda la regla ante carreras.
export interface ConnectionMethodRepository {
  activeMethod(
    userId: string,
    bankProvider: string
  ): Promise<ConnectionMethod | null>
  claim(
    userId: string,
    bankProvider: string,
    method: ConnectionMethod
  ): Promise<void>
  // Libera el método solo si es el vigente (desconectar scraper no libera email y viceversa).
  release(
    userId: string,
    bankProvider: string,
    method: ConnectionMethod
  ): Promise<void>
}

// --- Errores de negocio ---

// Ya existe otro método de conexión activo para ese banco (→ 409).
export class ConnectionMethodConflictError extends Error {
  constructor(active: ConnectionMethod) {
    super(
      active === "scraper"
        ? "Banco de Chile ya está conectado por scraper. Desconéctalo primero para usar el correo."
        : "Banco de Chile ya está conectado por correo. Desconéctalo primero para usar el scraper."
    )
    this.name = "ConnectionMethodConflictError"
  }
}

// No hay conexión de correo para el usuario (→ 404).
export class EmailConnectionNotFoundError extends Error {
  constructor() {
    super("No hay una conexión de correo configurada")
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

// La operación no corresponde al estado del setup (ej. confirmar sin conexión pendiente) (→ 422).
export class EmailSetupStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EmailSetupStateError"
  }
}
