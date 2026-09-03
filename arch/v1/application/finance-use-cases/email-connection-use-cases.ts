// Use-cases de la conexión por CORREO. Orquestan el proveedor de correo (port BankMailProvider),
// los repositorios de buzones y vínculos, y la persistencia (EmailSetupStore, implementada por
// infraestructura). Sin IO directo: nada de Prisma, fetch ni Next aquí.
//
// Flujo: OAuth del BUZÓN (connectMailbox) → agregar un banco a ese buzón (addBankLink) → escaneo del
// mes SIN persistir (scanEmailCandidates) → validación del usuario + snapshot (confirmEmailSetup,
// creación e importación atómicas) → sincronización incremental por delta/webhook (syncMailbox, una
// pasada que reparte entre los vínculos del buzón) → reconciliación manual (reconcileEmailBalances)
// → desconexión por banco o por buzón.
//
// Qué es de quién: la autorización, el delta y la suscripción son del BUZÓN; el snapshot, los
// instrumentos y los mensajes omitidos son del VÍNCULO con cada banco.
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"
import type {
  BucketKind,
  CardType,
  Direction,
  MovementStatus,
} from "../../domain/finance/finance.domain.ts"
import {
  BankAlreadyLinkedError,
  BankLabelRequiredError,
  EmailConnectionNotFoundError,
  EmailSetupStateError,
  type BankEmailMessage,
  type BankMailProvider,
  type ConnectionMethodRepository,
  type EmailBankLink,
  type EmailBankLinkRepository,
  type EmailBankLinkWithMailbox,
  type EmailMailbox,
  type EmailMailboxRepository,
} from "../../domain/finance/email-connection.domain.ts"
import type { NotifiableMovement } from "../notification-use-cases/notification-rules.ts"
import {
  BANK_EMAIL_REGISTRY,
  bankByKey,
  routeEmail,
  type BankEmailDefinition,
  type BankEmailRegistry,
} from "./bank-email-registry.ts"
import {
  isCheckingInstrument,
  type EmailEvent,
  type ParsedEmail,
} from "./bank-email-map.ts"
import {
  detectCandidates,
  type EmailScanSummary,
} from "./bancochile-email-candidates.ts"
import {
  applyCreditPurchase,
  applyDebitToCash,
  applyInternalCredit,
  applyInternalPayment,
  type BucketAmounts,
} from "./email-projection.ts"

// Renovar la suscripción cuando le queda menos de un día (Outlook la limita a <7 días; se renueva a
// diario vía sync/refresco; ver docs/email-connection-outlook.md).
const SUBSCRIPTION_RENEW_WINDOW_MS = 24 * 60 * 60 * 1000

// --- Persistencia (la implementa infraestructura con Prisma) ---

export type EmailBucketDef = {
  kind: BucketKind
  currency: CurrencyCode
  limitAmount: Money
  used: Money
  available: Money
}

export type EmailAccountDef = {
  key: string // "checking" | "card:<last4>" — clave temporal para vincular movimientos
  externalId: string // identidad estable: email:<bankKey>:acct:<ref> | email:<bankKey>:card:<last4>
  name: string
  accountType: "checking" | "credit_card"
  currency: CurrencyCode // moneda base de la cuenta (CLP)
  balance: Money // saldo representativo para la UI (caja disponible; deuda nacional en negativo)
  cardLast4: string
  card: { cardType: CardType; brand: string | null } | null
  buckets: EmailBucketDef[]
}

export type EmailMovementDef = {
  accountKey: string // referencia a EmailAccountDef.key
  bucketKind: BucketKind | null
  externalId: string
  date: Date
  description: string
  amount: Money
  direction: Direction
  status: MovementStatus // siempre "confirmed" (solo lectura)
  isInternal: boolean
}

export type EmailConfirmPersistInput = {
  linkId: string
  userId: string
  bankProvider: string
  bankName: string
  snapshotAt: Date
  accounts: EmailAccountDef[]
  movements: EmailMovementDef[]
}

// Instrumentos ya persistidos (para mapear eventos en la sincronización incremental).
export type EmailStoredAccount = {
  id: string
  accountType: string
  currency: CurrencyCode
  externalRef: string // dígitos del externalId (número de cuenta o últimos 4)
  cardLast4: string | null
}

export type EmailStoredBucket = {
  id: string
  accountId: string
  kind: BucketKind
  currency: CurrencyCode
  limitAmount: Money
  used: Money
  available: Money
}

export type ResolvedEmailMovement = {
  accountId: string
  bucketId: string | null
  externalId: string
  date: Date
  description: string
  amount: Money
  direction: Direction
  isInternal: boolean
}

// Lo que se pierde al desconectar un banco: sus cuentas arrastran en cascada datos que el usuario
// creó a mano, así que la UI los enumera antes de ejecutar.
export type BankDependents = {
  accounts: number
  movements: number
  recurring: number
  installments: number
  incomes: number
}

export interface EmailSetupStore {
  // Confirmación ATÓMICA: crea banco (con su provider y método email), cuentas, tarjetas y buckets,
  // e importa los movimientos del mes vinculados. Todo o nada.
  confirmSetup(input: EmailConfirmPersistInput): Promise<{
    bankId: string
    accounts: number
    cards: number
    movements: number
  }>
  listInstruments(
    bankId: string
  ): Promise<{ accounts: EmailStoredAccount[]; buckets: EmailStoredBucket[] }>
  // Upsert idempotente por (accountId, externalId) preservando categoría; devuelve los externalId
  // que resultaron NUEVOS (la proyección se aplica una sola vez por movimiento).
  upsertMovements(
    userId: string,
    movements: ResolvedEmailMovement[]
  ): Promise<{ createdExternalIds: string[] }>
  updateBucketAmounts(
    bucketId: string,
    amounts: BucketAmounts & { asOf: Date }
  ): Promise<void>
  setAccountBalance(accountId: string, amount: Money): Promise<void>
  markBankSynced(bankId: string): Promise<void>
  countBankDependents(bankId: string): Promise<BankDependents>
  deleteBank(bankId: string): Promise<void>
}

export type EmailConnectionDeps = {
  mailboxes: EmailMailboxRepository
  links: EmailBankLinkRepository
  methods: ConnectionMethodRepository
  mail: BankMailProvider
  store: EmailSetupStore
  // Catálogo de bancos. Inyectable para que los tests registren bancos de prueba sin esperar a que
  // exista un segundo banco real.
  registry?: BankEmailRegistry
  // Match contra plantillas recurrentes de los movimientos recién importados. Corre ANTES de la
  // IA: lo que reclama una plantilla ya queda categorizado y revisado, así que la IA no lo ve.
  matchRecurring?: (userId: string, externalIds: string[]) => Promise<number>
  // Cuotas de los planes que disparan estos movimientos: el pago de la tarjeta ejecuta las de sus
  // planes `card`, y el pago de una cuota de crédito lo adopta su plan `loan`. Corre ANTES de la
  // IA por lo mismo que el match: lo que un plan reclama ya queda categorizado y revisado.
  runInstallments?: (userId: string, externalIds: string[]) => Promise<number>
  // Categorización IA best-effort de lo importado no interno (una falla no revierte nada).
  categorize?: (userId: string) => Promise<number>
  // Notificación push de lo que entró SOLO por correo (best-effort, después de categorizar para
  // que el usuario abra la app con el movimiento ya clasificado).
  notify?: (userId: string, movements: NotifiableMovement[]) => Promise<void>
}

function registryOf(deps: { registry?: BankEmailRegistry }): BankEmailRegistry {
  return deps.registry ?? BANK_EMAIL_REGISTRY
}

// --- Helpers de ventana y mapeo ---

// Primer día del mes calendario actual (UTC), inicio de la carga inicial y fallback de sync.
export function firstDayOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

async function requireLink(
  deps: Pick<EmailConnectionDeps, "links">,
  userId: string,
  linkId: string
): Promise<EmailBankLinkWithMailbox> {
  const link = await deps.links.findById(linkId)
  if (!link || link.userId !== userId) throw new EmailConnectionNotFoundError()
  return link
}

async function requireMailbox(
  deps: Pick<EmailConnectionDeps, "mailboxes">,
  userId: string,
  mailboxId: string
): Promise<EmailMailbox> {
  const mailbox = await deps.mailboxes.findById(mailboxId)
  if (!mailbox || mailbox.userId !== userId)
    throw new EmailConnectionNotFoundError("No existe ese correo conectado")
  return mailbox
}

// Resuelve el instrumento/bucket de un evento contra los instrumentos confirmados. Null = sin
// mapeo inequívoco (se omite; nunca se adivina). Exportado para tests.
export function resolveEventTarget(
  event: EmailEvent,
  accounts: EmailStoredAccount[],
  buckets: EmailStoredBucket[]
): { accountId: string; bucketId: string | null } | null {
  const bucketOf = (
    accountId: string,
    kind: BucketKind,
    currency?: CurrencyCode
  ) =>
    buckets.find(
      (b) =>
        b.accountId === accountId &&
        b.kind === kind &&
        (!currency || b.currency === currency)
    ) ?? null

  if (
    event.paymentTarget === "credit_national" ||
    event.paymentTarget === "credit_international"
  ) {
    if (!event.instrument || event.instrument.kind !== "credit_card")
      return null
    const last4 = event.instrument.last4
    const matches = accounts.filter(
      (a) => a.accountType === "credit_card" && a.cardLast4 === last4
    )
    if (matches.length !== 1) return null
    const bucket = bucketOf(matches[0].id, event.paymentTarget)
    return bucket ? { accountId: matches[0].id, bucketId: bucket.id } : null
  }

  if (event.paymentTarget === "overdraft") {
    const target = resolveChecking(event, accounts)
    if (!target) return null
    const bucket = bucketOf(target.id, "overdraft")
    return bucket ? { accountId: target.id, bucketId: bucket.id } : null
  }

  if (!event.instrument) return null

  if (event.instrument.kind === "credit_card") {
    const last4 = event.instrument.last4
    const matches = accounts.filter(
      (a) => a.accountType === "credit_card" && a.cardLast4 === last4
    )
    if (matches.length !== 1) return null
    const kind: BucketKind =
      event.amount.currency === "USD"
        ? "credit_international"
        : "credit_national"
    const bucket = bucketOf(matches[0].id, kind, event.amount.currency)
    // Compra sin cupo declarado en esa moneda → sin mapeo (el usuario debe agregar el cupo).
    return bucket ? { accountId: matches[0].id, bucketId: bucket.id } : null
  }

  const target = resolveChecking(event, accounts)
  if (!target) return null
  const cash = bucketOf(target.id, "cash")
  return { accountId: target.id, bucketId: cash?.id ?? null }
}

// Cuenta corriente cuyo ref coincide (por número completo o últimos 4). Con cero o más de una
// coincidencia devuelve null (ambigüedad = omitir).
function resolveCheckingByRef(
  ref: string,
  accounts: EmailStoredAccount[]
): EmailStoredAccount | null {
  const matches = accounts.filter((a) => {
    if (a.accountType !== "checking") return false
    if (a.externalRef === ref) return true
    if (ref.length === 4) return a.externalRef.endsWith(ref)
    if (a.externalRef.length === 4) return ref.endsWith(a.externalRef)
    return false
  })
  return matches.length === 1 ? matches[0] : null
}

function resolveChecking(
  event: EmailEvent,
  accounts: EmailStoredAccount[]
): EmailStoredAccount | null {
  // "Tu cuenta principal": el correo no la numera, así que solo se resuelve si el vínculo tiene UNA
  // cuenta corriente. Con cero o varias se omite el movimiento — elegir una sería escribir el gasto
  // en la cuenta equivocada.
  if (event.instrument?.kind === "primary_checking") {
    const checking = accounts.filter((a) => a.accountType === "checking")
    return checking.length === 1 ? checking[0] : null
  }
  if (!event.instrument || event.instrument.kind !== "checking") return null
  return resolveCheckingByRef(event.instrument.ref, accounts)
}

// Pata de caja de un pago de tarjeta: la cuenta corriente de origen (por ref) y su bucket `cash`.
// Null si la cuenta no está confirmada (ambigüedad ⇒ se omite el pago completo).
function resolveCashLeg(
  ref: string,
  accounts: EmailStoredAccount[],
  buckets: EmailStoredBucket[]
): { accountId: string; bucketId: string | null } | null {
  const target = resolveCheckingByRef(ref, accounts)
  if (!target) return null
  const cash = buckets.find(
    (b) => b.accountId === target.id && b.kind === "cash"
  )
  return { accountId: target.id, bucketId: cash?.id ?? null }
}

// INVARIANTE, vale para CUALQUIER banco: un correo bancario nunca crea un ingreso. Del correo solo
// sale el gasto (`expense`); toda entrada de dinero — abono recibido, pago de tarjeta o de línea —
// es ajuste de saldo interno. El correo no distingue un sueldo de una devolución entre amigos, y
// adivinarlo inflaría el presupuesto con plata que no es ingreso. Los ingresos se declaran en el
// módulo de Ingresos, que es independiente del banco. Por eso `EmailEventKind` no tiene una variante
// de ingreso: la regla es estructural, no una decisión por banco.
function isInternalEvent(event: EmailEvent): boolean {
  return event.kind !== "expense"
}

function directionOf(event: EmailEvent): Direction {
  return isInternalEvent(event) ? "credit" : "debit"
}

// --- OAuth: alta / reconexión del BUZÓN ---

export type ConnectMailboxInput = {
  emailProvider: string // clave del proveedor por el que se autorizó (viene del estado OAuth firmado)
  emailAddress: string
  refreshToken: string
}

// Tras el intercambio OAuth: crea el buzón o, si ese correo ya estaba autorizado, rota el token y lo
// reactiva SIN borrar datos (caso reauth_required). Los bancos que alimenta no se tocan.
//
// El proveedor se reescribe también al reconectar: la misma dirección puede volver por otro
// proveedor, y la fila tiene que decir con cuál se habla ahora o el router elegiría el adapter viejo.
export async function connectMailbox(
  deps: Pick<EmailConnectionDeps, "mailboxes">,
  userId: string,
  input: ConnectMailboxInput
): Promise<{ mailbox: EmailMailbox; reconnected: boolean }> {
  const existing = await deps.mailboxes.findByAddress(
    userId,
    input.emailAddress
  )
  if (existing) {
    const mailbox = await deps.mailboxes.update(existing.id, {
      emailProvider: input.emailProvider,
      refreshToken: input.refreshToken,
      status: "active",
      lastError: null,
    })
    return { mailbox, reconnected: true }
  }
  const mailbox = await deps.mailboxes.create({
    userId,
    emailProvider: input.emailProvider,
    emailAddress: input.emailAddress,
    refreshToken: input.refreshToken,
  })
  return { mailbox, reconnected: false }
}

// --- Agregar un banco a un buzón ya autorizado (sin OAuth nuevo) ---

export type AddBankLinkInput = {
  mailboxId: string
  bankProvider: string
  label?: string | null
}

export async function addBankLink(
  deps: Pick<
    EmailConnectionDeps,
    "mailboxes" | "links" | "methods" | "registry"
  >,
  userId: string,
  input: AddBankLinkInput
): Promise<EmailBankLink> {
  const bank = bankByKey(input.bankProvider, registryOf(deps))
  await requireMailbox(deps, userId, input.mailboxId)

  const existing = await deps.links.listByUser(userId)
  // Mismo banco en ESTE buzón: el enrutado por remitente no tendría cómo decidir a cuál imputar.
  if (
    existing.some(
      (l) => l.mailboxId === input.mailboxId && l.bankProvider === bank.key
    )
  )
    throw new BankAlreadyLinkedError(bank.name)
  // Mismo banco en OTRO buzón: se permite, pero necesita etiqueta para distinguirlos a la vista.
  const label = input.label?.trim() || null
  if (existing.some((l) => l.bankProvider === bank.key) && !label)
    throw new BankLabelRequiredError(bank.name)

  await deps.methods.claim(userId, bank.key, input.mailboxId, "email")
  try {
    return await deps.links.create({
      mailboxId: input.mailboxId,
      userId,
      bankProvider: bank.key,
      label,
    })
  } catch (e) {
    await deps.methods
      .release(userId, bank.key, input.mailboxId, "email")
      .catch(() => {})
    throw e
  }
}

// Nombre visible del banco: el del catálogo más su etiqueta ("Banco de Chile Empresa").
export function bankDisplayName(
  bankName: string,
  label: string | null
): string {
  return label ? `${bankName} ${label}` : bankName
}

// --- Escaneo inicial (sin persistir) ---

export type ScanResult = EmailScanSummary & {
  emailAddress: string
  bankProvider: string
  bankName: string
  since: string
}

// Cuántos meses hacia atrás se busca actividad del banco al conectarlo. Un banco que no notificó
// nada en medio año no tiene nada que importar, y el tope mantiene la búsqueda acotada.
const SCAN_LOOKBACK_MONTHS = 6

function monthsBefore(date: Date, months: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1)
  )
}

// Último instante del mes de `date`, para que la descarga se quede en ese mes.
function endOfMonth(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1
  )
}

// Ventana del escaneo inicial: el mes de la última notificación del banco que PRODUZCA movimientos,
// hasta el instante del vínculo.
//
// El mes calendario no sirve: si el usuario no movió ese banco este mes, el escaneo vendría vacío y
// no habría instrumentos que confirmar. Y la última notificación tampoco basta por sí sola —un
// remitente puede mandar marketing, y los avisos de dinero entrante se descartan a propósito—, así
// que se retrocede mes a mes CON actividad hasta dar con uno que traiga movimientos.
//
// Ambos use-cases del setup la comparten: si cada uno la calculara por su lado, la confirmación
// podría importar un rango distinto del que el usuario revisó.
async function resolveScanWindow(
  deps: Pick<EmailConnectionDeps, "mail" | "registry">,
  mailboxId: string,
  bank: BankEmailDefinition,
  scanUntil: Date
): Promise<{ since: Date; parsed: ParsedEmail[] }> {
  const floor = monthsBefore(scanUntil, SCAN_LOOKBACK_MONTHS)
  let until = scanUntil
  // La ventana más reciente con correos suyos, aunque ninguno haya producido movimiento: sus
  // motivos de omisión son lo que se le muestra al usuario si no hay nada más.
  let mostRecent: { since: Date; parsed: ParsedEmail[] } | null = null
  for (let attempt = 0; attempt <= SCAN_LOOKBACK_MONTHS; attempt++) {
    const last = await deps.mail.lastMessageDate(
      mailboxId,
      bank.senders,
      floor,
      until
    )
    if (!last) break
    const since = firstDayOfMonth(last)
    const monthEnd = endOfMonth(since)
    const parsed = await parseBankMonth(
      deps,
      mailboxId,
      bank,
      since,
      monthEnd.getTime() < scanUntil.getTime() ? monthEnd : scanUntil
    )
    mostRecent ??= { since, parsed }
    if (parsed.some((p) => p.ok)) return { since, parsed }
    until = new Date(since.getTime() - 1) // sigue buscando antes de este mes
  }
  return mostRecent ?? { since: firstDayOfMonth(scanUntil), parsed: [] }
}

// Correos de ESTE banco en la ventana, ya parseados. Los de otro banco del mismo buzón no son
// candidatos suyos ni cuentan como omitidos.
//
// El filtro por remitentes viaja al proveedor: pedir el mes entero y descartar en memoria significa
// descargar miles de correos con sus cuerpos para quedarse con un puñado, y eso es lo que dejaba el
// escaneo colgado en buzones con volumen. El enrutado se vuelve a aplicar acá igual, porque el
// proveedor puede no soportar el filtro y devolver de más.
async function parseBankMonth(
  deps: Pick<EmailConnectionDeps, "mail" | "registry">,
  mailboxId: string,
  bank: BankEmailDefinition,
  since: Date,
  until: Date
): Promise<ParsedEmail[]> {
  const messages = await deps.mail.listMessagesSince(
    mailboxId,
    since,
    until,
    bank.senders
  )
  return messages
    .filter((message) => message.receivedAt.getTime() <= until.getTime())
    .filter(
      (message) => routeEmail(message, registryOf(deps))?.key === bank.key
    )
    .map(bank.parse)
}

export async function scanEmailCandidates(
  deps: Pick<EmailConnectionDeps, "links" | "mail" | "registry">,
  userId: string,
  linkId: string,
  opts: { now?: Date } = {}
): Promise<ScanResult> {
  const link = await requireLink(deps, userId, linkId)
  if (link.bankId)
    throw new EmailSetupStateError(
      "Ese banco ya fue configurado; usa el refresco manual"
    )
  const bank = bankByKey(link.bankProvider, registryOf(deps))
  const now = opts.now ?? new Date()
  const scanUntil =
    link.createdAt.getTime() <= now.getTime() ? link.createdAt : now
  const { since, parsed } = await resolveScanWindow(
    deps,
    link.mailboxId,
    bank,
    scanUntil
  )
  return {
    ...detectCandidates(parsed),
    emailAddress: link.mailbox.emailAddress,
    bankProvider: bank.key,
    bankName: bankDisplayName(bank.name, link.label),
    since: since.toISOString(),
  }
}

// --- Confirmación: crear instrumentos + snapshot + importar el mes (atómico) ---

export type EmailSnapshotInput = {
  snapshotAt: Date
  checking: {
    ref: string // número de cuenta o últimos 4 (dígitos)
    cash: Money // saldo propio disponible CLP
    overdraft: { limit: Money; used: Money } | null // opcional: sin sobregiro no se inventa bucket
  } | null
  cards: {
    last4: string
    national: { limit: Money; used: Money } | null // CLP
    international: { limit: Money; used: Money } | null // USD
  }[]
}

export type ConfirmResult = {
  bankId: string
  accounts: number
  cards: number
  movements: number
  skipped: number // omitidos: sin datos o sin mapeo inequívoco
}

export async function confirmEmailSetup(
  deps: EmailConnectionDeps,
  userId: string,
  linkId: string,
  input: EmailSnapshotInput,
  opts: { now?: Date } = {}
): Promise<ConfirmResult> {
  const link = await requireLink(deps, userId, linkId)
  if (link.bankId)
    throw new EmailSetupStateError("Ese banco ya fue configurado")
  if (!input.checking && input.cards.length === 0)
    throw new EmailSetupStateError(
      "Confirma al menos un instrumento (cuenta o tarjeta)"
    )
  const bank = bankByKey(link.bankProvider, registryOf(deps))
  const now = opts.now ?? new Date()
  const scanUntil =
    link.createdAt.getTime() <= now.getTime() ? link.createdAt : now

  // Instrumentos y buckets desde el snapshot ingresado (available = limit − used).
  const accounts: EmailAccountDef[] = []
  if (input.checking) {
    const ref = input.checking.ref.replace(/\D/g, "")
    if (ref.length < 4)
      throw new EmailSetupStateError(
        "El número de cuenta debe tener al menos 4 dígitos"
      )
    const buckets: EmailBucketDef[] = [
      {
        kind: "cash",
        currency: "CLP",
        limitAmount: Money.zero("CLP"),
        used: Money.zero("CLP"),
        available: input.checking.cash,
      },
    ]
    if (input.checking.overdraft) {
      const { limit, used } = input.checking.overdraft
      buckets.push({
        kind: "overdraft",
        currency: "CLP",
        limitAmount: limit,
        used,
        available: limit.subtract(used),
      })
    }
    accounts.push({
      key: "checking",
      externalId: accountExternalId(bank.key, "acct", ref),
      name: "Cuenta Corriente",
      accountType: "checking",
      currency: "CLP",
      balance: input.checking.cash,
      cardLast4: ref.slice(-4),
      card: { cardType: "debito", brand: null },
      buckets,
    })
  }
  for (const card of input.cards) {
    const last4 = card.last4.replace(/\D/g, "")
    if (!/^\d{4}$/.test(last4))
      throw new EmailSetupStateError(
        "Los últimos 4 de la tarjeta deben ser 4 dígitos"
      )
    if (!card.national && !card.international)
      throw new EmailSetupStateError(
        `La tarjeta ${last4} necesita al menos un cupo (nacional o internacional)`
      )
    const buckets: EmailBucketDef[] = []
    if (card.national) {
      buckets.push({
        kind: "credit_national",
        currency: "CLP",
        limitAmount: card.national.limit,
        used: card.national.used,
        available: card.national.limit.subtract(card.national.used),
      })
    }
    if (card.international) {
      buckets.push({
        kind: "credit_international",
        currency: "USD",
        limitAmount: card.international.limit,
        used: card.international.used,
        available: card.international.limit.subtract(card.international.used),
      })
    }
    accounts.push({
      key: `card:${last4}`,
      externalId: accountExternalId(bank.key, "card", last4),
      name: `Tarjeta de Crédito •••• ${last4}`,
      accountType: "credit_card",
      currency: "CLP",
      balance: card.national ? card.national.used.negate() : Money.zero("CLP"),
      cardLast4: last4,
      card: { cardType: "credito", brand: null },
      buckets,
    })
  }

  // Releer la MISMA ventana que vio el usuario en el escaneo (refrescar obliga a reescanear; no hay
  // modelo de borradores). Se recalcula, no se guarda: parte del mismo `scanUntil`, que no cambia.
  const { parsed } = await resolveScanWindow(
    deps,
    link.mailboxId,
    bank,
    scanUntil
  )

  // Mapeo evento → cuenta/bucket confirmados, usando claves temporales (los ids reales nacen en la
  // transacción de confirmSetup). La proyección solo considera eventos POSTERIORES al snapshot.
  const stored = toStoredForMapping(accounts)
  const movements: EmailMovementDef[] = []
  let skipped = 0
  const events = parsed
    .filter((p): p is Extract<ParsedEmail, { ok: true }> => p.ok)
    .map((p) => p.event)
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
  skipped += parsed.length - events.length

  const projected = new Map<string, EmailBucketDef>() // key: accountKey + kind
  for (const acc of accounts)
    for (const b of acc.buckets) projected.set(`${acc.key}:${b.kind}`, b)

  for (const event of events) {
    const target = resolveEventTarget(event, stored.accounts, stored.buckets)
    if (!target) {
      skipped++
      continue
    }
    // Pago de tarjeta: la pata de caja (cuenta de origen) debe resolver también, o se omite el pago
    // completo (nunca medio pago).
    let cashTarget: { accountId: string; bucketId: string | null } | null = null
    if (event.cashLeg) {
      cashTarget = resolveCashLeg(
        event.cashLeg.ref,
        stored.accounts,
        stored.buckets
      )
      if (!cashTarget) {
        skipped++
        continue
      }
    }
    // Los movimientos del mes hasta el snapshot NO se re-descuentan de los saldos ingresados. Se
    // compara con el instante de recepción del correo (precisión real), no con la fecha de día.
    const posterior = event.receivedAt.getTime() > input.snapshotAt.getTime()
    // Con dos patas, cada movimiento lleva su externalId sufijado para ser único e idempotente.
    const debtExternalId = event.cashLeg
      ? `${event.externalId}:card`
      : event.externalId
    movements.push({
      accountKey: target.accountId, // en el mapeo temporal, accountId === key
      bucketKind: target.bucketId as BucketKind | null, // y bucketId === kind
      externalId: debtExternalId,
      date: event.date,
      description: event.description,
      amount: event.amount,
      direction: directionOf(event),
      status: "confirmed",
      isInternal: isInternalEvent(event),
    })
    if (posterior) applyEventToProjection(projected, target.accountId, event)
    if (event.cashLeg && cashTarget) {
      movements.push({
        accountKey: cashTarget.accountId,
        bucketKind: "cash",
        externalId: `${event.externalId}:cash`,
        date: event.date,
        description: event.description,
        amount: event.cashLeg.amount,
        direction: "debit",
        status: "confirmed",
        isInternal: true,
      })
      if (posterior)
        applyCashDebitToProjection(
          projected,
          cashTarget.accountId,
          event.cashLeg.amount
        )
    }
  }

  // Vuelca la proyección final a los buckets/saldos que se persisten.
  for (const acc of accounts) {
    acc.buckets = acc.buckets.map(
      (b) => projected.get(`${acc.key}:${b.kind}`) ?? b
    )
    const cash = acc.buckets.find((b) => b.kind === "cash")
    const nat = acc.buckets.find((b) => b.kind === "credit_national")
    acc.balance = cash ? cash.available : nat ? nat.used.negate() : acc.balance
  }

  const result = await deps.store.confirmSetup({
    linkId: link.id,
    userId,
    bankProvider: bank.key,
    bankName: bankDisplayName(bank.name, link.label),
    snapshotAt: input.snapshotAt,
    accounts,
    movements,
  })

  // Estado delta desde AHORA (el mes ya quedó importado) + suscripción webhook best-effort. Ambos
  // son del buzón: si otro banco del mismo buzón ya los dejó listos, esto solo los refresca.
  const mailbox = link.mailbox
  let deltaLink = mailbox.deltaLink
  let subscriptionId = mailbox.subscriptionId
  let subscriptionExpiresAt = mailbox.subscriptionExpiresAt
  let lastError: string | null = null
  try {
    if (!deltaLink) deltaLink = await deps.mail.startDelta(mailbox.id, now)
  } catch (e) {
    lastError = `Delta no disponible: ${(e as Error).message}`
  }
  try {
    const sub = await deps.mail.ensureSubscription(mailbox.id)
    if (sub) {
      subscriptionId = sub.subscriptionId
      subscriptionExpiresAt = sub.expiresAt
    }
  } catch (e) {
    lastError = `Suscripción webhook no disponible: ${(e as Error).message}`
  }

  await deps.mailboxes.update(mailbox.id, {
    status: "active",
    deltaLink,
    subscriptionId,
    subscriptionExpiresAt,
    lastSyncedAt: now,
    lastError,
  })
  // bankId, status y snapshot ya quedaron dentro de la transacción de confirmSetup.
  await deps.links.update(link.id, {
    skippedCount: link.skippedCount + skipped,
  })

  // Categorización IA best-effort (solo no internos; una falla no revierte la importación).
  if (deps.categorize) await deps.categorize(userId).catch(() => {})

  return { ...result, skipped }
}

// Identidad externa de una cuenta importada: incluye el banco, porque dos bancos pueden tener el
// mismo número de cuenta o los mismos últimos 4 y el unique es por usuario.
export function accountExternalId(
  bankKey: string,
  kind: "acct" | "card",
  ref: string
): string {
  return `email:${bankKey}:${kind}:${ref}`
}

// Mapeo temporal: usa key/kind como ids para reutilizar resolveEventTarget antes de persistir.
function toStoredForMapping(accounts: EmailAccountDef[]): {
  accounts: EmailStoredAccount[]
  buckets: EmailStoredBucket[]
} {
  return {
    accounts: accounts.map((a) => ({
      id: a.key,
      accountType: a.accountType,
      currency: a.currency,
      externalRef: a.externalId.replace(/\D/g, ""),
      cardLast4: a.cardLast4,
    })),
    buckets: accounts.flatMap((a) =>
      a.buckets.map((b) => ({
        id: b.kind,
        accountId: a.key,
        kind: b.kind,
        currency: b.currency,
        limitAmount: b.limitAmount,
        used: b.used,
        available: b.available,
      }))
    ),
  }
}

// Aplica un evento a la proyección en memoria de los buckets de una cuenta (por clave temporal).
function applyEventToProjection(
  projected: Map<string, EmailBucketDef>,
  accountKey: string,
  event: EmailEvent
): void {
  const get = (kind: BucketKind) =>
    projected.get(`${accountKey}:${kind}`) ?? null
  const set = (kind: BucketKind, amounts: BucketAmounts) => {
    const prev = projected.get(`${accountKey}:${kind}`)
    if (prev) projected.set(`${accountKey}:${kind}`, { ...prev, ...amounts })
  }

  if (event.kind === "expense" && isCheckingInstrument(event.instrument)) {
    const cash = get("cash")
    if (!cash) return
    const res = applyDebitToCash(cash, get("overdraft"), event.amount)
    set("cash", res.cash)
    if (res.overdraft) set("overdraft", res.overdraft)
    return
  }
  if (event.kind === "expense" && event.instrument?.kind === "credit_card") {
    const kind: BucketKind =
      event.amount.currency === "USD"
        ? "credit_international"
        : "credit_national"
    const bucket = get(kind)
    if (bucket) set(kind, applyCreditPurchase(bucket, event.amount))
    return
  }
  if (event.kind === "internal_credit") {
    const cash = get("cash")
    if (!cash) return
    const res = applyInternalCredit(cash, get("overdraft"), event.amount)
    set("cash", res.cash)
    if (res.overdraft) set("overdraft", res.overdraft)
    return
  }
  if (event.kind === "internal_payment" && event.paymentTarget) {
    const bucket = get(event.paymentTarget)
    if (bucket)
      set(event.paymentTarget, applyInternalPayment(bucket, event.amount))
  }
}

// Pata de caja de un pago de tarjeta sobre la proyección temporal: débito CLP a la corriente de
// origen (consume caja; el exceso va al sobregiro, igual que un cargo).
function applyCashDebitToProjection(
  projected: Map<string, EmailBucketDef>,
  accountKey: string,
  amount: Money
): void {
  const cash = projected.get(`${accountKey}:cash`)
  if (!cash) return
  const overdraft = projected.get(`${accountKey}:overdraft`) ?? null
  const res = applyDebitToCash(cash, overdraft, amount)
  projected.set(`${accountKey}:cash`, { ...cash, ...res.cash })
  if (overdraft && res.overdraft)
    projected.set(`${accountKey}:overdraft`, { ...overdraft, ...res.overdraft })
}

// --- Sincronización incremental (delta / webhook / refresco manual) ---

export type EmailSyncResult = {
  imported: number
  created: number
  skipped: number // correos de un banco vinculado que no pudieron convertirse en movimiento
  discarded: number // correos que ningún banco vinculado a este buzón reclama
}

// Una pasada por BUZÓN: trae los mensajes nuevos una sola vez y los reparte entre sus vínculos según
// el banco que el enrutado les atribuya.
export async function syncMailbox(
  deps: EmailConnectionDeps,
  mailboxId: string,
  opts: {
    now?: Date
    messages?: BankEmailMessage[]
    // Reproceso explícito desde una fecha: relee el buzón en vez de avanzar el delta, para
    // recuperar correos que ya pasaron por el cursor y no dejaron movimiento (una plantilla que el
    // parser todavía no reconocía). No toca el deltaLink, así que la sincronización normal sigue
    // donde iba. Releer es seguro —`upsertMovements` no duplica y solo lo nuevo proyecta— pero
    // traerse el buzón entero es caro: por eso la fecha es obligatoria en este modo.
    reprocessSince?: Date
  } = {}
): Promise<EmailSyncResult> {
  const mailbox = await deps.mailboxes.findById(mailboxId)
  if (!mailbox)
    throw new EmailConnectionNotFoundError("No existe ese correo conectado")
  const links = (await deps.links.listByMailbox(mailboxId)).filter(
    (l) => l.bankId !== null
  )
  const now = opts.now ?? new Date()

  // Mensajes nuevos: los inyectados (webhook ya los trajo de Graph) o el delta guardado.
  let messages: BankEmailMessage[]
  let deltaLink = mailbox.deltaLink
  try {
    if (opts.messages) {
      messages = opts.messages
    } else if (opts.reprocessSince) {
      // Acotado a los remitentes de los bancos vinculados: releer el buzón entero para rescatar
      // unos pocos avisos serían miles de correos con cuerpo.
      const senders = links.flatMap(
        (l) => bankByKey(l.bankProvider, registryOf(deps)).senders
      )
      messages = await deps.mail.listMessagesSince(
        mailbox.id,
        opts.reprocessSince,
        undefined,
        senders
      )
    } else if (mailbox.deltaLink) {
      const res = await deps.mail.runDelta(mailbox.id, mailbox.deltaLink)
      messages = res.messages
      deltaLink = res.deltaLink
    } else {
      // Sin estado delta (caso borde): releer desde la última sync o el inicio del mes.
      const since = mailbox.lastSyncedAt ?? firstDayOfMonth(now)
      messages = await deps.mail.listMessagesSince(mailbox.id, since)
      deltaLink = await deps.mail.startDelta(mailbox.id, now)
    }
  } catch (e) {
    await markSyncError(deps, mailbox, e as Error)
    throw e
  }

  // Reparto por banco. Un correo que ningún banco del catálogo reclama, o que pertenece a un banco
  // sin vínculo en este buzón, se descarta a nivel de buzón: no es omisión de nadie.
  const byLink = new Map<string, BankEmailMessage[]>()
  let discarded = 0
  for (const message of messages) {
    const bank = routeEmail(message, registryOf(deps))
    const link = bank
      ? links.find((l) => l.bankProvider === bank.key)
      : undefined
    if (!link) {
      discarded++
      continue
    }
    const list = byLink.get(link.id)
    if (list) list.push(message)
    else byLink.set(link.id, [message])
  }

  let imported = 0
  let skipped = 0
  const created: string[] = []
  const notifiable: NotifiableMovement[] = []
  for (const link of links) {
    const own = byLink.get(link.id)
    if (!own || own.length === 0) continue
    const res = await importIntoLink(deps, link, own, now)
    imported += res.imported
    skipped += res.skipped
    created.push(...res.created)
    notifiable.push(...res.notifiable)
    await deps.links.update(link.id, {
      skippedCount: link.skippedCount + res.skipped,
    })
  }

  // Renovación diaria de la suscripción (best-effort; su falla no pierde datos: delta recupera).
  let subscriptionId = mailbox.subscriptionId
  let subscriptionExpiresAt = mailbox.subscriptionExpiresAt
  let lastError: string | null = null
  const needsRenewal =
    !mailbox.subscriptionExpiresAt ||
    mailbox.subscriptionExpiresAt.getTime() - now.getTime() <
      SUBSCRIPTION_RENEW_WINDOW_MS
  if (needsRenewal) {
    try {
      const sub = await deps.mail.ensureSubscription(mailbox.id)
      if (sub) {
        subscriptionId = sub.subscriptionId
        subscriptionExpiresAt = sub.expiresAt
      }
    } catch (e) {
      lastError = `Suscripción webhook no disponible: ${(e as Error).message}`
    }
  }

  await deps.mailboxes.update(mailbox.id, {
    status: "active",
    deltaLink,
    subscriptionId,
    subscriptionExpiresAt,
    lastSyncedAt: now,
    lastError,
    // Un reproceso vuelve a ver los mismos correos ajenos: sumarlos otra vez falsearía el contador.
    discardedCount:
      mailbox.discardedCount + (opts.reprocessSince ? 0 : discarded),
  })

  if (created.length > 0) {
    // Plantilla > IA: el match corre primero y deja categorizado y revisado lo que reclama.
    if (deps.matchRecurring)
      await deps.matchRecurring(mailbox.userId, created).catch(() => {})
    if (deps.runInstallments)
      await deps.runInstallments(mailbox.userId, created).catch(() => {})
    if (deps.categorize) await deps.categorize(mailbox.userId).catch(() => {})
    // Solo lo que el usuario NO registró a mano y no es un traspaso interno merece notificación.
    if (deps.notify && notifiable.length > 0)
      await deps.notify(mailbox.userId, notifiable).catch(() => {})
  }

  return { imported, created: created.length, skipped, discarded }
}

// Refresco manual: sincroniza todos los buzones del usuario.
export async function syncUserMailboxes(
  deps: EmailConnectionDeps,
  userId: string,
  opts: { now?: Date; reprocessSince?: Date } = {}
): Promise<EmailSyncResult> {
  const mailboxes = await deps.mailboxes.listByUser(userId)
  if (mailboxes.length === 0) throw new EmailConnectionNotFoundError()
  const total: EmailSyncResult = {
    imported: 0,
    created: 0,
    skipped: 0,
    discarded: 0,
  }
  for (const mailbox of mailboxes) {
    const res = await syncMailbox(deps, mailbox.id, opts)
    total.imported += res.imported
    total.created += res.created
    total.skipped += res.skipped
    total.discarded += res.discarded
  }
  return total
}

// Importa los mensajes de UN banco sobre los instrumentos de su vínculo.
async function importIntoLink(
  deps: EmailConnectionDeps,
  link: EmailBankLink,
  messages: BankEmailMessage[],
  now: Date
): Promise<{
  imported: number
  skipped: number
  created: string[]
  notifiable: NotifiableMovement[]
}> {
  const bank = bankByKey(link.bankProvider, registryOf(deps))
  const parsed = messages.map(bank.parse)
  const events = parsed
    .filter((p): p is Extract<ParsedEmail, { ok: true }> => p.ok)
    .map((p) => p.event)
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
  let skipped = parsed.length - events.length

  const { accounts, buckets } = await deps.store.listInstruments(link.bankId!)
  const resolved: ResolvedEmailMovement[] = []
  const byExternalId = new Map<string, EmailEvent>()
  for (const event of events) {
    const target = resolveEventTarget(event, accounts, buckets)
    if (!target) {
      skipped++
      continue
    }
    // Pago de tarjeta: la pata de caja debe resolver también, o se omite el pago completo.
    let cashTarget: { accountId: string; bucketId: string | null } | null = null
    if (event.cashLeg) {
      cashTarget = resolveCashLeg(event.cashLeg.ref, accounts, buckets)
      if (!cashTarget) {
        skipped++
        continue
      }
    }
    const debtExternalId = event.cashLeg
      ? `${event.externalId}:card`
      : event.externalId
    resolved.push({
      accountId: target.accountId,
      bucketId: target.bucketId,
      externalId: debtExternalId,
      date: event.date,
      description: event.description,
      amount: event.amount,
      direction: directionOf(event),
      isInternal: isInternalEvent(event),
    })
    byExternalId.set(debtExternalId, event)
    if (event.cashLeg && cashTarget) {
      const cashExternalId = `${event.externalId}:cash`
      resolved.push({
        accountId: cashTarget.accountId,
        bucketId: cashTarget.bucketId,
        externalId: cashExternalId,
        date: event.date,
        description: event.description,
        amount: event.cashLeg.amount,
        direction: "debit",
        isInternal: true,
      })
      byExternalId.set(cashExternalId, event)
    }
  }

  const { createdExternalIds } = await deps.store.upsertMovements(
    link.userId,
    resolved
  )

  // Proyección: SOLO movimientos nuevos y posteriores al snapshot vigente mueven los buckets
  // (reprocesos por webhook/delta no descuentan dos veces).
  const reconciledAt = link.lastBalanceReconciledAt?.getTime() ?? 0
  const bucketById = new Map(buckets.map((b) => [b.id, { ...b }]))
  const touchedAccounts = new Set<string>()
  const createdSet = new Set(createdExternalIds)
  for (const mov of resolved) {
    const event = byExternalId.get(mov.externalId)
    if (!event) continue
    // Solo nuevos y recibidos DESPUÉS del snapshot vigente mueven la proyección.
    if (
      !createdSet.has(mov.externalId) ||
      event.receivedAt.getTime() <= reconciledAt
    )
      continue
    // Pata de caja del pago de tarjeta: débito a la corriente de origen; el resto (incl. la pata de
    // deuda) usa la proyección del evento.
    if (event.cashLeg && mov.externalId === `${event.externalId}:cash`) {
      applyCashDebitToStoredBuckets(
        bucketById,
        mov.accountId,
        event.cashLeg.amount
      )
    } else {
      applyEventToStoredBuckets(bucketById, mov.accountId, event)
    }
    touchedAccounts.add(mov.accountId)
  }
  for (const accountId of touchedAccounts) {
    const accBuckets = [...bucketById.values()].filter(
      (b) => b.accountId === accountId
    )
    for (const b of accBuckets) {
      await deps.store.updateBucketAmounts(b.id, {
        limitAmount: b.limitAmount,
        used: b.used,
        available: b.available,
        asOf: now,
      })
    }
    const cash = accBuckets.find((b) => b.kind === "cash")
    const nat = accBuckets.find((b) => b.kind === "credit_national")
    if (cash) await deps.store.setAccountBalance(accountId, cash.available)
    else if (nat)
      await deps.store.setAccountBalance(accountId, nat.used.negate())
  }

  await deps.store.markBankSynced(link.bankId!)

  const notifiable: NotifiableMovement[] = resolved
    .filter((m) => createdSet.has(m.externalId) && !m.isInternal)
    .map((m) => ({
      description: m.description,
      amount: m.amount.toMajor(),
      currency: m.amount.currency,
      direction: m.direction,
      externalId: m.externalId,
    }))

  return {
    imported: resolved.length,
    skipped,
    created: createdExternalIds,
    notifiable,
  }
}

function applyEventToStoredBuckets(
  bucketById: Map<string, EmailStoredBucket>,
  accountId: string,
  event: EmailEvent
): void {
  const ofKind = (kind: BucketKind) =>
    [...bucketById.values()].find(
      (b) => b.accountId === accountId && b.kind === kind
    ) ?? null
  const set = (bucket: EmailStoredBucket | null, amounts: BucketAmounts) => {
    if (bucket) bucketById.set(bucket.id, { ...bucket, ...amounts })
  }

  if (event.kind === "expense" && isCheckingInstrument(event.instrument)) {
    const cash = ofKind("cash")
    if (!cash) return
    const od = ofKind("overdraft")
    const res = applyDebitToCash(cash, od, event.amount)
    set(cash, res.cash)
    if (od && res.overdraft) set(od, res.overdraft)
    return
  }
  if (event.kind === "expense" && event.instrument?.kind === "credit_card") {
    const kind: BucketKind =
      event.amount.currency === "USD"
        ? "credit_international"
        : "credit_national"
    const bucket = ofKind(kind)
    if (bucket) set(bucket, applyCreditPurchase(bucket, event.amount))
    return
  }
  if (event.kind === "internal_credit") {
    const cash = ofKind("cash")
    if (!cash) return
    const od = ofKind("overdraft")
    const res = applyInternalCredit(cash, od, event.amount)
    set(cash, res.cash)
    if (od && res.overdraft) set(od, res.overdraft)
    return
  }
  if (event.kind === "internal_payment" && event.paymentTarget) {
    const bucket = ofKind(event.paymentTarget)
    if (bucket) set(bucket, applyInternalPayment(bucket, event.amount))
  }
}

// Pata de caja de un pago de tarjeta sobre los buckets persistidos: débito CLP a la corriente de
// origen (consume caja; el exceso va al sobregiro).
function applyCashDebitToStoredBuckets(
  bucketById: Map<string, EmailStoredBucket>,
  accountId: string,
  amount: Money
): void {
  const ofKind = (kind: BucketKind) =>
    [...bucketById.values()].find(
      (b) => b.accountId === accountId && b.kind === kind
    ) ?? null
  const cash = ofKind("cash")
  if (!cash) return
  const od = ofKind("overdraft")
  const res = applyDebitToCash(cash, od, amount)
  bucketById.set(cash.id, { ...cash, ...res.cash })
  if (od && res.overdraft) bucketById.set(od.id, { ...od, ...res.overdraft })
}

async function markSyncError(
  deps: Pick<EmailConnectionDeps, "mailboxes">,
  mailbox: EmailMailbox,
  error: Error
): Promise<void> {
  const reauth = error.name === "EmailReauthRequiredError"
  await deps.mailboxes
    .update(mailbox.id, {
      status: reauth ? "reauth_required" : "error",
      lastError: error.message,
    })
    .catch(() => {})
}

// --- Reconciliación manual ("Actualizar saldos") ---

export async function reconcileEmailBalances(
  deps: EmailConnectionDeps,
  userId: string,
  linkId: string,
  input: EmailSnapshotInput
): Promise<{ updatedBuckets: number }> {
  const link = await requireLink(deps, userId, linkId)
  if (!link.bankId)
    throw new EmailSetupStateError(
      "Ese banco aún no completa su configuración inicial"
    )
  const { accounts, buckets } = await deps.store.listInstruments(link.bankId)

  const bucketOf = (accountId: string, kind: BucketKind) =>
    buckets.find((b) => b.accountId === accountId && b.kind === kind) ?? null

  // Todo o nada (WDC-81): primero se resuelve contra qué bucket va CADA dato que el usuario
  // ingresó, y recién cuando todo calzó se escribe. Si algo ingresado no calza —o calza con más de
  // una cuenta, o no tiene bucket donde caer— se corta acá, antes de la primera escritura: cero
  // saldos tocados y el cursor intacto. Antes la corriente podía quedar escrita (y el cursor
  // avanzado) aunque una tarjeta no calzara, y los movimientos de esa tarjeta entre el cursor
  // viejo y el snapshot quedaban fuera de la proyección para siempre, sin aviso.
  //
  // Omitir sigue siendo legítimo y no exige calce: no ingresar cuenta corriente, o mandar una
  // tarjeta con los dos cupos apagados ("esta no la actualices"), no es un dato ingresado.
  const rechazo = (detalle: string) =>
    new EmailSetupStateError(`No se guardó ningún saldo: ${detalle}`)

  let corriente: {
    datos: NonNullable<EmailSnapshotInput["checking"]>
    accountId: string
    cajaId: string
    sobregiroId: string | null
  } | null = null

  if (input.checking) {
    const ref = input.checking.ref.replace(/\D/g, "")
    // Sin dígitos de los dos lados no hay nada que comparar: `"loQueSea".endsWith("")` es true, así
    // que un ref vacío emparejaría con la primera corriente, y una cuenta guardada sin externalId
    // (externalRef === "") emparejaría con cualquier ref. En ambos casos el saldo caería sobre la
    // cuenta equivocada, sin error (WDC-80).
    //
    // Y "más de una coincidencia" no elige: `listInstruments` consulta sin `orderBy`, así que
    // quedarse con "la primera" ni siquiera está definido. Ambigüedad = rechazar.
    const matches = accounts.filter(
      (a) =>
        a.accountType === "checking" &&
        ref !== "" &&
        a.externalRef !== "" &&
        (a.externalRef === ref ||
          a.externalRef.endsWith(ref) ||
          ref.endsWith(a.externalRef))
    )
    if (matches.length === 0)
      throw rechazo(
        `el número de cuenta «${input.checking.ref}» no calza con ninguna cuenta corriente de este banco`
      )
    if (matches.length > 1)
      throw rechazo(
        `el número de cuenta «${input.checking.ref}» calza con más de una cuenta corriente; escribe más dígitos`
      )
    const account = matches[0]
    // Una cuenta creada a mano existe sin buckets: calza, pero no hay caja donde escribir el
    // saldo, y escribir solo su `balance` (el espejo del bucket) sería guardar a medias.
    const caja = bucketOf(account.id, "cash")
    if (!caja)
      throw rechazo(
        `la cuenta corriente «${input.checking.ref}» no tiene dónde llevar el saldo en este banco`
      )
    let sobregiro = null
    if (input.checking.overdraft) {
      sobregiro = bucketOf(account.id, "overdraft")
      if (!sobregiro)
        throw rechazo(
          `la cuenta corriente «${input.checking.ref}» no tiene línea de sobregiro en este banco; apágala para guardar`
        )
    }
    corriente = {
      datos: input.checking,
      accountId: account.id,
      cajaId: caja.id,
      sobregiroId: sobregiro?.id ?? null,
    }
  }

  const tarjetas: {
    datos: EmailSnapshotInput["cards"][number]
    accountId: string
    nacionalId: string | null
    internacionalId: string | null
  }[] = []
  for (const card of input.cards) {
    // Los dos cupos apagados = "esta no la actualices": no hay dato que escribir, así que tampoco
    // se le exige calzar.
    if (!card.national && !card.international) continue
    const last4 = card.last4.replace(/\D/g, "")
    // `last4 !== ""` por el mismo motivo que arriba: la comparación acá es por igualdad, y un
    // vacío solo calzaría con una tarjeta guardada sin last4 — igual de equivocado.
    const matches = accounts.filter(
      (a) =>
        a.accountType === "credit_card" && last4 !== "" && a.cardLast4 === last4
    )
    if (matches.length === 0)
      throw rechazo(
        `la tarjeta «${card.last4}» no calza con ninguna tarjeta de este banco`
      )
    if (matches.length > 1)
      throw rechazo(
        `hay más de una tarjeta terminada en «${card.last4}» y no se sabe cuál actualizar`
      )
    const account = matches[0]
    const nacional = card.national
      ? bucketOf(account.id, "credit_national")
      : null
    if (card.national && !nacional)
      throw rechazo(
        `la tarjeta «${card.last4}» no tiene cupo nacional en este banco; apágalo para guardar`
      )
    const internacional = card.international
      ? bucketOf(account.id, "credit_international")
      : null
    if (card.international && !internacional)
      throw rechazo(
        `la tarjeta «${card.last4}» no tiene cupo internacional en este banco; apágalo para guardar`
      )
    tarjetas.push({
      datos: card,
      accountId: account.id,
      nacionalId: nacional?.id ?? null,
      internacionalId: internacional?.id ?? null,
    })
  }

  // Nada ingresado, nada que escribir — y avanzar el cursor sin escribir es peor que no hacer
  // nada: `lastBalanceReconciledAt` gobierna la proyección (los eventos con
  // `receivedAt <= reconciledAt` ya no mueven buckets), así que moverlo dejaría FUERA para siempre
  // todo lo ocurrido entre el cursor viejo y este snapshot — los movimientos se importan, pero los
  // saldos quedan desviados sin manera de recuperarlos. El 422 sale por el toast de la pantalla.
  if (!corriente && tarjetas.length === 0)
    throw new EmailSetupStateError(
      "No hay ningún saldo que actualizar: ingresa tu cuenta corriente o enciende al menos un cupo"
    )

  // Fase de escritura: de aquí para abajo todo dato ingresado ya tiene su bucket resuelto.
  let updated = 0
  const write = async (bucketId: string, limitAmount: Money, used: Money) => {
    await deps.store.updateBucketAmounts(bucketId, {
      limitAmount,
      used,
      available: limitAmount.subtract(used),
      asOf: input.snapshotAt,
    })
    updated++
  }

  if (corriente) {
    await deps.store.updateBucketAmounts(corriente.cajaId, {
      limitAmount: Money.zero("CLP"),
      used: Money.zero("CLP"),
      available: corriente.datos.cash,
      asOf: input.snapshotAt,
    })
    updated++
    // El balance de la cuenta es un espejo del bucket, así que se escribe junto con él — la misma
    // regla que usa la proyección.
    await deps.store.setAccountBalance(
      corriente.accountId,
      corriente.datos.cash
    )
    if (corriente.sobregiroId && corriente.datos.overdraft)
      await write(
        corriente.sobregiroId,
        corriente.datos.overdraft.limit,
        corriente.datos.overdraft.used
      )
  }

  for (const t of tarjetas) {
    if (t.nacionalId && t.datos.national) {
      await write(t.nacionalId, t.datos.national.limit, t.datos.national.used)
      await deps.store.setAccountBalance(
        t.accountId,
        t.datos.national.used.negate()
      )
    }
    if (t.internacionalId && t.datos.international)
      await write(
        t.internacionalId,
        t.datos.international.limit,
        t.datos.international.used
      )
  }

  await deps.links.update(link.id, {
    lastBalanceReconciledAt: input.snapshotAt,
  })
  return { updatedBuckets: updated }
}

// --- Desconexión segura ---

// Qué se pierde al desconectar este banco. Las cuentas arrastran en cascada lo que el usuario creó
// sobre ellas (ingresos, recurrentes, cuotas): la UI lo enumera antes de ejecutar.
export async function describeBankRemoval(
  deps: Pick<EmailConnectionDeps, "links" | "store">,
  userId: string,
  linkId: string
): Promise<BankDependents> {
  const link = await requireLink(deps, userId, linkId)
  if (!link.bankId)
    return {
      accounts: 0,
      movements: 0,
      recurring: 0,
      installments: 0,
      incomes: 0,
    }
  return deps.store.countBankDependents(link.bankId)
}

// Desconecta UN banco: borra su vínculo y sus datos financieros. Los demás bancos del buzón siguen
// vivos; si era el último, el buzón se va con su suscripción y su token.
export async function disconnectBankLink(
  deps: Pick<
    EmailConnectionDeps,
    "mailboxes" | "links" | "methods" | "mail" | "store"
  >,
  userId: string,
  linkId: string
): Promise<void> {
  const link = await requireLink(deps, userId, linkId)
  if (link.bankId) await deps.store.deleteBank(link.bankId)
  await deps.links.delete(link.id)
  await deps.methods
    .release(userId, link.bankProvider, link.mailboxId, "email")
    .catch(() => {})
  const remaining = await deps.links.listByMailbox(link.mailboxId)
  if (remaining.length === 0) await removeMailbox(deps, link.mailboxId)
}

// Igual que la anterior, pero identificando el banco por su id en los datos del usuario. La UI de
// una cuenta conoce su banco, no el vínculo que lo alimenta: pedirle el vínculo la obligaría a
// cruzar el estado de la conexión por su cuenta.
export async function disconnectBankById(
  deps: Pick<
    EmailConnectionDeps,
    "mailboxes" | "links" | "methods" | "mail" | "store"
  >,
  userId: string,
  bankId: string
): Promise<void> {
  const link = (await deps.links.listByUser(userId)).find(
    (l) => l.bankId === bankId
  )
  if (!link)
    throw new EmailConnectionNotFoundError(
      "Ese banco no tiene una conexión de correo"
    )
  await disconnectBankLink(deps, userId, link.id)
}

// Desconecta un buzón completo: equivale a desconectar todos sus bancos.
export async function disconnectMailbox(
  deps: Pick<
    EmailConnectionDeps,
    "mailboxes" | "links" | "methods" | "mail" | "store"
  >,
  userId: string,
  mailboxId: string
): Promise<void> {
  await requireMailbox(deps, userId, mailboxId)
  const links = await deps.links.listByMailbox(mailboxId)
  for (const link of links) {
    if (link.bankId) await deps.store.deleteBank(link.bankId)
    await deps.links.delete(link.id)
    await deps.methods
      .release(userId, link.bankProvider, mailboxId, "email")
      .catch(() => {})
  }
  await removeMailbox(deps, mailboxId)
}

async function removeMailbox(
  deps: Pick<EmailConnectionDeps, "mailboxes" | "mail">,
  mailboxId: string
): Promise<void> {
  // Best-effort: si Microsoft falla, igual se borra local (el usuario no queda atascado).
  await deps.mail.deleteSubscription(mailboxId).catch(() => {})
  await deps.mailboxes.delete(mailboxId)
}

// --- Webhook: localizar el buzón notificado (la validación de clientState la hace el caller) ---

export async function findWebhookMailbox(
  deps: Pick<EmailConnectionDeps, "mailboxes">,
  subscriptionId: string
): Promise<EmailMailbox | null> {
  return deps.mailboxes.findBySubscriptionId(subscriptionId)
}

// --- Vista de estado para la UI (sin tokens ni contenido de correo) ---

export type EmailBankLinkDTO = {
  id: string
  bankProvider: string
  bankId: string | null // banco creado por este vínculo; null mientras está en setup
  bankName: string // nombre del catálogo + etiqueta
  label: string | null
  pendingSetup: boolean
  skippedCount: number
  lastBalanceReconciledAt: string | null
}

export type EmailMailboxDTO = {
  id: string
  emailProvider: string // clave; el nombre visible lo resuelve la UI con la lista de /status
  emailAddress: string
  status: string
  lastSyncedAt: string | null
  lastError: string | null
  discardedCount: number
  webhookActive: boolean
  banks: EmailBankLinkDTO[]
}

export type EmailConnectionViewDTO = {
  mailboxes: EmailMailboxDTO[]
  // Bancos del catálogo que este usuario todavía puede agregar, por buzón.
  availableBanks: { key: string; name: string }[]
}

export async function getEmailConnectionView(
  deps: Pick<EmailConnectionDeps, "mailboxes" | "links" | "registry">,
  userId: string
): Promise<EmailConnectionViewDTO> {
  const [mailboxes, links] = await Promise.all([
    deps.mailboxes.listByUser(userId),
    deps.links.listByUser(userId),
  ])
  const registry = registryOf(deps)
  return {
    mailboxes: mailboxes.map((m) => ({
      id: m.id,
      emailProvider: m.emailProvider,
      emailAddress: m.emailAddress,
      status: m.status,
      lastSyncedAt: m.lastSyncedAt?.toISOString() ?? null,
      lastError: m.lastError,
      discardedCount: m.discardedCount,
      webhookActive: Boolean(m.subscriptionId),
      banks: links
        .filter((l) => l.mailboxId === m.id)
        .map((l) => {
          const bank = registry.find((b) => b.key === l.bankProvider)
          return {
            id: l.id,
            bankProvider: l.bankProvider,
            bankId: l.bankId,
            bankName: bankDisplayName(bank?.name ?? l.bankProvider, l.label),
            label: l.label,
            pendingSetup: !l.bankId,
            skippedCount: l.skippedCount,
            lastBalanceReconciledAt:
              l.lastBalanceReconciledAt?.toISOString() ?? null,
          }
        }),
    })),
    availableBanks: registry.map((b) => ({ key: b.key, name: b.name })),
  }
}
