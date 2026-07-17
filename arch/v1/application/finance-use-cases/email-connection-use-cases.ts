// Use-cases de la conexión por CORREO (Outlook → Banco de Chile). Orquestan el proveedor de correo
// (port BankMailProvider), el repositorio de conexiones y la persistencia (EmailSetupStore,
// implementada por infraestructura). Sin IO directo: nada de Prisma, fetch ni Next aquí.
//
// Flujo: OAuth (completeEmailConnection) → escaneo del mes SIN persistir (scanEmailCandidates) →
// validación del usuario + snapshot (confirmEmailSetup, creación e importación atómicas) →
// sincronización incremental por delta/webhook (syncEmailConnection) → reconciliación manual
// (reconcileEmailBalances) → desconexión (disconnectEmailConnection).
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"
import type {
  BucketKind,
  CardType,
  Direction,
  MovementStatus,
} from "../../domain/finance/finance.domain.ts"
import {
  EmailConnectionNotFoundError,
  EmailSetupStateError,
  type BankEmailMessage,
  type BankMailProvider,
  type ConnectionMethodRepository,
  type EmailConnection,
  type EmailConnectionRepository,
} from "../../domain/finance/email-connection.domain.ts"
import {
  parseBancoChileEmail,
  type EmailEvent,
  type ParsedEmail,
} from "./bancochile-email-map.ts"
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

export const BANK_PROVIDER = "bancochile"
const BANK_NAME = "Banco de Chile"
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
  externalId: string // identidad estable: email:acct:<ref> | email:card:<last4>
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
  connectionId: string
  userId: string
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

export interface EmailSetupStore {
  // Confirmación ATÓMICA: crea banco (provider bancochile, método email), cuentas, tarjetas y
  // buckets, e importa los movimientos del mes vinculados. Todo o nada.
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
  deleteBank(bankId: string): Promise<void>
}

export type EmailConnectionDeps = {
  emailConnections: EmailConnectionRepository
  methods: ConnectionMethodRepository
  mail: BankMailProvider
  store: EmailSetupStore
  // Categorización IA best-effort de lo importado no interno (una falla no revierte nada).
  categorize?: (userId: string) => Promise<number>
}

// --- Helpers de ventana y mapeo ---

// Primer día del mes calendario actual (UTC), inicio de la carga inicial.
export function firstDayOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

async function requireConnection(
  deps: EmailConnectionDeps,
  userId: string
): Promise<EmailConnection> {
  const conn = await deps.emailConnections.findByUser(userId, BANK_PROVIDER)
  if (!conn) throw new EmailConnectionNotFoundError()
  return conn
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

// Cuenta corriente cuyo ref coincide con el del evento (por número completo o últimos 4). Con cero
// o más de una coincidencia devuelve null (ambigüedad = omitir).
function resolveChecking(
  event: EmailEvent,
  accounts: EmailStoredAccount[]
): EmailStoredAccount | null {
  if (!event.instrument || event.instrument.kind !== "checking") return null
  const ref = event.instrument.ref
  const matches = accounts.filter((a) => {
    if (a.accountType !== "checking") return false
    if (a.externalRef === ref) return true
    if (ref.length === 4) return a.externalRef.endsWith(ref)
    if (a.externalRef.length === 4) return ref.endsWith(a.externalRef)
    return false
  })
  return matches.length === 1 ? matches[0] : null
}

function directionOf(event: EmailEvent): Direction {
  return event.kind === "expense" ? "debit" : "credit"
}

// --- OAuth: alta / reconexión ---

export type CompleteEmailConnectionInput = {
  emailAddress: string
  refreshToken: string
}

// Tras el intercambio OAuth: crea la conexión (reclamando el método `email`) o, si ya existía,
// rota el token y la reactiva SIN borrar datos (caso reauth_required).
export async function completeEmailConnection(
  deps: Pick<EmailConnectionDeps, "emailConnections" | "methods">,
  userId: string,
  input: CompleteEmailConnectionInput
): Promise<{ connection: EmailConnection; reconnected: boolean }> {
  const existing = await deps.emailConnections.findByUser(userId, BANK_PROVIDER)
  if (existing) {
    const active = await deps.methods.activeMethod(userId, BANK_PROVIDER)
    if (!active) await deps.methods.claim(userId, BANK_PROVIDER, "email")
    const connection = await deps.emailConnections.update(existing.id, {
      emailAddress: input.emailAddress,
      refreshToken: input.refreshToken,
      status: existing.bankId ? "active" : "pending_setup",
      lastError: null,
    })
    return { connection, reconnected: true }
  }
  // Exclusividad: reclama el método `email` (la fila única por usuario+banco rechaza al segundo).
  await deps.methods.claim(userId, BANK_PROVIDER, "email")
  try {
    const connection = await deps.emailConnections.create({
      userId,
      bankProvider: BANK_PROVIDER,
      emailProvider: "outlook",
      emailAddress: input.emailAddress,
      refreshToken: input.refreshToken,
    })
    return { connection, reconnected: false }
  } catch (e) {
    await deps.methods.release(userId, BANK_PROVIDER, "email").catch(() => {})
    throw e
  }
}

// --- Escaneo inicial (sin persistir) ---

export type ScanResult = EmailScanSummary & {
  emailAddress: string
  since: string
}

export async function scanEmailCandidates(
  deps: Pick<EmailConnectionDeps, "emailConnections" | "mail">,
  userId: string,
  opts: { now?: Date } = {}
): Promise<ScanResult> {
  const conn = await requireConnection(deps as EmailConnectionDeps, userId)
  if (conn.bankId)
    throw new EmailSetupStateError(
      "La conexión ya fue configurada; usa el refresco manual"
    )
  const now = opts.now ?? new Date()
  const scanUntil =
    conn.createdAt.getTime() <= now.getTime() ? conn.createdAt : now
  const since = firstDayOfMonth(scanUntil)
  const messages = await deps.mail.listMessagesSince(conn.id, since)
  const parsed = messages
    .filter((message) => message.receivedAt.getTime() <= scanUntil.getTime())
    .map(parseBancoChileEmail)
  return {
    ...detectCandidates(parsed),
    emailAddress: conn.emailAddress,
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
  skipped: number // omitidos: fuera de allowlist, sin datos o sin mapeo inequívoco
}

export async function confirmEmailSetup(
  deps: EmailConnectionDeps,
  userId: string,
  input: EmailSnapshotInput,
  opts: { now?: Date } = {}
): Promise<ConfirmResult> {
  const conn = await requireConnection(deps, userId)
  if (conn.bankId)
    throw new EmailSetupStateError("La conexión ya fue configurada")
  if (!input.checking && input.cards.length === 0)
    throw new EmailSetupStateError(
      "Confirma al menos un instrumento (cuenta o tarjeta)"
    )
  const now = opts.now ?? new Date()
  const scanUntil =
    conn.createdAt.getTime() <= now.getTime() ? conn.createdAt : now
  const since = firstDayOfMonth(scanUntil)

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
      externalId: `email:acct:${ref}`,
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
      externalId: `email:card:${last4}`,
      name: `Tarjeta de Crédito •••• ${last4}`,
      accountType: "credit_card",
      currency: "CLP",
      balance: card.national ? card.national.used.negate() : Money.zero("CLP"),
      cardLast4: last4,
      card: { cardType: "credito", brand: null },
      buckets,
    })
  }

  // Releer el mes completo (refrescar obliga a reescanear; no hay modelo de borradores).
  const messages = (await deps.mail.listMessagesSince(conn.id, since)).filter(
    (message) => message.receivedAt.getTime() <= scanUntil.getTime()
  )
  const parsed = messages.map(parseBancoChileEmail)

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
    const accountKey = target.accountId // en el mapeo temporal, accountId === key
    const bucketKind = target.bucketId as BucketKind | null // y bucketId === kind
    movements.push({
      accountKey,
      bucketKind,
      externalId: event.externalId,
      date: event.date,
      description: event.description,
      amount: event.amount,
      direction: directionOf(event),
      status: "confirmed",
      isInternal: event.kind !== "expense",
    })
    // Los movimientos del mes hasta el snapshot NO se re-descuentan de los saldos ingresados. Se
    // compara con el instante de recepción del correo (precisión real), no con la fecha de día.
    if (event.receivedAt.getTime() > input.snapshotAt.getTime()) {
      applyEventToProjection(projected, accountKey, event)
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
    connectionId: conn.id,
    userId,
    bankName: BANK_NAME,
    snapshotAt: input.snapshotAt,
    accounts,
    movements,
  })

  // Estado delta desde AHORA (el mes ya quedó importado) + suscripción webhook best-effort.
  let deltaLink: string | null = null
  let subscriptionId = conn.subscriptionId
  let subscriptionExpiresAt = conn.subscriptionExpiresAt
  let lastError: string | null = null
  try {
    deltaLink = await deps.mail.startDelta(conn.id, now)
  } catch (e) {
    lastError = `Delta no disponible: ${(e as Error).message}`
  }
  try {
    const sub = await deps.mail.ensureSubscription(conn.id)
    if (sub) {
      subscriptionId = sub.subscriptionId
      subscriptionExpiresAt = sub.expiresAt
    }
  } catch (e) {
    lastError = `Suscripción webhook no disponible: ${(e as Error).message}`
  }

  await deps.emailConnections.update(conn.id, {
    status: "active",
    deltaLink,
    subscriptionId,
    subscriptionExpiresAt,
    lastSyncedAt: now,
    lastError,
    skippedCount: conn.skippedCount + skipped,
    lastBalanceReconciledAt: input.snapshotAt,
  })

  // Categorización IA best-effort (solo no internos; una falla no revierte la importación).
  if (deps.categorize) await deps.categorize(userId).catch(() => {})

  return { ...result, skipped }
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

  if (event.kind === "expense" && event.instrument?.kind === "checking") {
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

// --- Sincronización incremental (delta / webhook / refresco manual) ---

export type EmailSyncResult = {
  imported: number
  created: number
  skipped: number
}

export async function syncEmailConnection(
  deps: EmailConnectionDeps,
  userId: string,
  opts: { now?: Date; messages?: BankEmailMessage[] } = {}
): Promise<EmailSyncResult> {
  const conn = await requireConnection(deps, userId)
  if (!conn.bankId)
    throw new EmailSetupStateError(
      "La conexión aún no completa su configuración inicial"
    )
  const now = opts.now ?? new Date()

  // Mensajes nuevos: los inyectados (webhook ya los trajo de Graph) o el delta guardado.
  let messages: BankEmailMessage[]
  let deltaLink = conn.deltaLink
  try {
    if (opts.messages) {
      messages = opts.messages
    } else if (conn.deltaLink) {
      const res = await deps.mail.runDelta(conn.id, conn.deltaLink)
      messages = res.messages
      deltaLink = res.deltaLink
    } else {
      // Sin estado delta (caso borde): releer desde la última sync o el inicio del mes.
      const since = conn.lastSyncedAt ?? firstDayOfMonth(now)
      messages = await deps.mail.listMessagesSince(conn.id, since)
      deltaLink = await deps.mail.startDelta(conn.id, now)
    }
  } catch (e) {
    await markSyncError(deps, conn, e as Error)
    throw e
  }

  const parsed = messages.map(parseBancoChileEmail)
  const events = parsed
    .filter((p): p is Extract<ParsedEmail, { ok: true }> => p.ok)
    .map((p) => p.event)
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
  let skipped = parsed.length - events.length

  const { accounts, buckets } = await deps.store.listInstruments(conn.bankId)
  const resolved: ResolvedEmailMovement[] = []
  const byExternalId = new Map<string, EmailEvent>()
  for (const event of events) {
    const target = resolveEventTarget(event, accounts, buckets)
    if (!target) {
      skipped++
      continue
    }
    resolved.push({
      accountId: target.accountId,
      bucketId: target.bucketId,
      externalId: event.externalId,
      date: event.date,
      description: event.description,
      amount: event.amount,
      direction: directionOf(event),
      isInternal: event.kind !== "expense",
    })
    byExternalId.set(event.externalId, event)
  }

  const { createdExternalIds } = await deps.store.upsertMovements(
    userId,
    resolved
  )

  // Proyección: SOLO movimientos nuevos y posteriores al snapshot vigente mueven los buckets
  // (reprocesos por webhook/delta no descuentan dos veces).
  const reconciledAt = conn.lastBalanceReconciledAt?.getTime() ?? 0
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
    applyEventToStoredBuckets(bucketById, mov.accountId, event)
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

  // Renovación diaria de la suscripción (best-effort; su falla no pierde datos: delta recupera).
  let subscriptionId = conn.subscriptionId
  let subscriptionExpiresAt = conn.subscriptionExpiresAt
  let lastError: string | null = null
  const needsRenewal =
    !conn.subscriptionExpiresAt ||
    conn.subscriptionExpiresAt.getTime() - now.getTime() <
      SUBSCRIPTION_RENEW_WINDOW_MS
  if (needsRenewal) {
    try {
      const sub = await deps.mail.ensureSubscription(conn.id)
      if (sub) {
        subscriptionId = sub.subscriptionId
        subscriptionExpiresAt = sub.expiresAt
      }
    } catch (e) {
      lastError = `Suscripción webhook no disponible: ${(e as Error).message}`
    }
  }

  await deps.emailConnections.update(conn.id, {
    status: "active",
    deltaLink,
    subscriptionId,
    subscriptionExpiresAt,
    lastSyncedAt: now,
    lastError,
    skippedCount: conn.skippedCount + skipped,
  })
  await deps.store.markBankSynced(conn.bankId)

  if (deps.categorize && createdExternalIds.length > 0)
    await deps.categorize(userId).catch(() => {})

  return {
    imported: resolved.length,
    created: createdExternalIds.length,
    skipped,
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

  if (event.kind === "expense" && event.instrument?.kind === "checking") {
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

async function markSyncError(
  deps: EmailConnectionDeps,
  conn: EmailConnection,
  error: Error
): Promise<void> {
  const reauth = error.name === "EmailReauthRequiredError"
  await deps.emailConnections
    .update(conn.id, {
      status: reauth ? "reauth_required" : "error",
      lastError: error.message,
    })
    .catch(() => {})
}

// --- Reconciliación manual ("Actualizar saldos") ---

export async function reconcileEmailBalances(
  deps: EmailConnectionDeps,
  userId: string,
  input: EmailSnapshotInput
): Promise<{ updatedBuckets: number }> {
  const conn = await requireConnection(deps, userId)
  if (!conn.bankId)
    throw new EmailSetupStateError(
      "La conexión aún no completa su configuración inicial"
    )
  const { accounts, buckets } = await deps.store.listInstruments(conn.bankId)
  let updated = 0

  const apply = async (
    accountId: string,
    kind: BucketKind,
    limitAmount: Money,
    used: Money
  ) => {
    const bucket = buckets.find(
      (b) => b.accountId === accountId && b.kind === kind
    )
    if (!bucket) return
    await deps.store.updateBucketAmounts(bucket.id, {
      limitAmount,
      used,
      available: limitAmount.subtract(used),
      asOf: input.snapshotAt,
    })
    updated++
  }

  if (input.checking) {
    const ref = input.checking.ref.replace(/\D/g, "")
    const account = accounts.find(
      (a) =>
        a.accountType === "checking" &&
        (a.externalRef === ref ||
          a.externalRef.endsWith(ref) ||
          ref.endsWith(a.externalRef))
    )
    if (account) {
      const cash = buckets.find(
        (b) => b.accountId === account.id && b.kind === "cash"
      )
      if (cash) {
        await deps.store.updateBucketAmounts(cash.id, {
          limitAmount: Money.zero("CLP"),
          used: Money.zero("CLP"),
          available: input.checking.cash,
          asOf: input.snapshotAt,
        })
        updated++
      }
      if (input.checking.overdraft) {
        await apply(
          account.id,
          "overdraft",
          input.checking.overdraft.limit,
          input.checking.overdraft.used
        )
      }
      await deps.store.setAccountBalance(account.id, input.checking.cash)
    }
  }
  for (const card of input.cards) {
    const last4 = card.last4.replace(/\D/g, "")
    const account = accounts.find(
      (a) => a.accountType === "credit_card" && a.cardLast4 === last4
    )
    if (!account) continue
    if (card.national) {
      await apply(
        account.id,
        "credit_national",
        card.national.limit,
        card.national.used
      )
      await deps.store.setAccountBalance(
        account.id,
        card.national.used.negate()
      )
    }
    if (card.international)
      await apply(
        account.id,
        "credit_international",
        card.international.limit,
        card.international.used
      )
  }

  await deps.emailConnections.update(conn.id, {
    lastBalanceReconciledAt: input.snapshotAt,
  })
  return { updatedBuckets: updated }
}

// --- Desconexión segura ---

export async function disconnectEmailConnection(
  deps: EmailConnectionDeps,
  userId: string
): Promise<void> {
  const conn = await deps.emailConnections.findByUser(userId, BANK_PROVIDER)
  if (!conn) throw new EmailConnectionNotFoundError()
  // Best-effort: si Microsoft falla, igual se borra local (el usuario no queda atascado).
  await deps.mail.deleteSubscription(conn.id).catch(() => {})
  if (conn.bankId) await deps.store.deleteBank(conn.bankId)
  await deps.emailConnections.delete(conn.id)
  await deps.methods.release(userId, BANK_PROVIDER, "email")
}

// --- Webhook: localizar la conexión notificada (la validación de clientState la hace el caller) ---

export async function findWebhookConnection(
  deps: Pick<EmailConnectionDeps, "emailConnections">,
  subscriptionId: string
): Promise<EmailConnection | null> {
  return deps.emailConnections.findBySubscriptionId(subscriptionId)
}

// --- Vista de estado para la UI (sin tokens ni contenido de correo) ---

export type EmailConnectionViewDTO = {
  activeMethod: "email" | null
  status: string
  emailAddress: string
  pendingSetup: boolean
  lastSyncedAt: string | null
  lastBalanceReconciledAt: string | null
  skippedCount: number
  lastError: string | null
  webhookActive: boolean
} | null

export async function getEmailConnectionView(
  deps: Pick<EmailConnectionDeps, "emailConnections" | "methods">,
  userId: string
): Promise<EmailConnectionViewDTO> {
  const [conn, activeMethod] = await Promise.all([
    deps.emailConnections.findByUser(userId, BANK_PROVIDER),
    deps.methods.activeMethod(userId, BANK_PROVIDER),
  ])
  if (!conn) return null
  return {
    activeMethod,
    status: conn.status,
    emailAddress: conn.emailAddress,
    pendingSetup: !conn.bankId,
    lastSyncedAt: conn.lastSyncedAt?.toISOString() ?? null,
    lastBalanceReconciledAt:
      conn.lastBalanceReconciledAt?.toISOString() ?? null,
    skippedCount: conn.skippedCount,
    lastError: conn.lastError,
    webhookActive: Boolean(conn.subscriptionId),
  }
}
