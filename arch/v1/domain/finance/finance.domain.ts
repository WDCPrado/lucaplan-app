// Dominio financiero. Puro: sin Prisma, sin DB, sin Next. Entidades + enums + ports.
// Los montos usan el value object Money (ver money.ts): enteros por moneda, sin float,
// y prohíbe mezclar CLP/USD. La caja activa, el uso por categoría y el estado se derivan
// por fórmula (arch/v1/application/finance-use-cases), no son campos ni tablas.

import type { CurrencyCode, Money } from "./money.ts"

// --- Enums de dominio ---

export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "credit_card",
  "credit_line",
  "wallet",
  "investment",
] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

// Tipos de cuenta con tarjeta física: exigen últimos 4 dígitos y tienen arte de tarjeta.
export const CARD_ACCOUNT_TYPES = ["checking", "credit_card"] as const

// ¿Este tipo de cuenta tiene tarjeta? (checking = débito, credit_card = crédito).
export function accountHasCard(t: AccountType): boolean {
  return t === "checking" || t === "credit_card"
}

// Variante de tarjeta por tipo, para resolver el arte: "debito" | "credito" | null (sin tarjeta).
export function cardVariant(t: AccountType): "debito" | "credito" | null {
  if (t === "checking") return "debito"
  if (t === "credit_card") return "credito"
  return null
}

export const DIRECTIONS = ["debit", "credit"] as const
export type Direction = (typeof DIRECTIONS)[number]

// Origen de un banco/cuenta/movimiento: creado a mano, o leído de las notificaciones por correo de
// Banco de Chile (`bancochile`, solo lectura).
export const PROVIDERS = ["manual", "bancochile"] as const
export type Provider = (typeof PROVIDERS)[number]

// Tipo de tarjeta física asociada a una cuenta.
export const CARD_TYPES = ["debito", "credito"] as const
export type CardType = (typeof CARD_TYPES)[number]

// Tipo de saldo/cupo (bucket): una MEDICIÓN mutable de la cuenta/tarjeta, no el libro contable.
//  - cash: dinero propio de la cuenta corriente (única caja activa).
//  - overdraft: sobregiro/línea de crédito de la corriente; su `used` es DEUDA, no caja.
//  - credit_national / credit_international: cupos de una tarjeta de crédito (CLP / USD).
export const BUCKET_KINDS = [
  "cash",
  "overdraft",
  "credit_national",
  "credit_international",
] as const
export type BucketKind = (typeof BUCKET_KINDS)[number]

// ¿Este bucket cuenta como caja activa? Solo `cash`. Sobregiro y cupos son deuda/capacidad de deuda.
export function bucketIsCash(kind: BucketKind): boolean {
  return kind === "cash"
}

// Estado del movimiento reportado por el proveedor. Solo `confirmed` cuenta para caja/presupuesto.
export const MOVEMENT_STATUSES = [
  "confirmed",
  "pending",
  "reversed",
  "duplicated",
] as const
export type MovementStatus = (typeof MOVEMENT_STATUSES)[number]

// Estado de una categoría según cuánto de su límite se usó.
export const CATEGORY_STATUSES = [
  "bueno",
  "moderado",
  "completado",
  "excedido",
] as const
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number]

// Tipo de categoría: clasifica ingresos o gastos. Una categoría solo aplica a movimientos de su
// lado (income ↔ credit, expense ↔ debit); no se mezclan.
export const CATEGORY_TYPES = ["income", "expense"] as const
export type CategoryType = (typeof CATEGORY_TYPES)[number]

// Tipo de categoría que corresponde a una dirección de movimiento.
export function categoryTypeForDirection(direction: Direction): CategoryType {
  return direction === "credit" ? "income" : "expense"
}

// --- Entidades ---

export type Bank = {
  id: string
  userId: string
  name: string
  isActive: boolean
  provider: Provider // "manual" | "bancochile"
  connectionMethod?: "email" | null // solo bancos conectados; null en los manuales
  lastSyncedAt: Date | null
}

export type Account = {
  id: string
  userId: string
  bankId: string
  name: string
  accountType: AccountType
  currency: CurrencyCode
  balance: Money // puede ser negativo en checking (sobregiro usado = deuda)
  overdraftLimit: Money
  color: string | null // presentación
  cardLast4: string | null // últimos 4 dígitos de la tarjeta; obligatorio en tipos con tarjeta (checking/credit_card)
  provider: Provider // "manual" | "bancochile"; las conectadas son de solo lectura
  externalId: string | null // id de la cuenta en el banco (número de cuenta / últimos 4)
}

// Tarjeta física de una cuenta. Una cuenta corriente tiene una tarjeta de débito; una cuenta de
// crédito puede tener 1+ tarjetas de crédito. Se crea solo con identidad real del banco (últimos 4).
export type Card = {
  id: string
  userId: string
  accountId: string
  cardType: CardType // "debito" | "credito"
  cardLast4: string // 4 dígitos reales, nunca el número completo
  brand: string | null // marca/presentación (ej. "Visa Signature")
  provider: Provider
  externalId: string | null // id/máscara de la tarjeta en el banco
}

// Saldo/cupo como MEDICIÓN mutable (used/available/limit) con marca de tiempo del dato del banco
// (`asOf`). Pertenece a una cuenta y, si aplica, a una tarjeta. Los buckets de distinta moneda
// (CLP nacional, USD internacional) se mantienen SEPARADOS y nunca se suman.
export type BalanceBucket = {
  id: string
  userId: string
  accountId: string
  cardId: string | null
  kind: BucketKind
  currency: CurrencyCode
  limitAmount: Money // límite/cupo total autorizado (0 si no aplica)
  used: Money // usado = deuda (en overdraft/crédito); 0 en cash
  available: Money // disponible reportado por el banco
  asOf: Date | null // marca de tiempo del dato del banco
}

// Sobregiro usado (deuda) calculado desde la línea: autorizado − disponible. El banco infla el
// "disponible" sumándole la línea, así que su disponible NO es caja; calcularlo es más seguro.
export function overdraftUsed(limitAmount: Money, available: Money): Money {
  return limitAmount.subtract(available)
}

// Categoría GLOBAL del usuario, compartida entre todos los meses. El límite NO vive aquí.
export type Category = {
  id: string
  userId: string
  name: string
  type: CategoryType // "income" (ingreso) | "expense" (gasto)
  icon: string | null // presentación (icono lucide o emoji)
  color: string | null // presentación
  description: string | null // contexto para la categorización con IA; no afecta cálculos
}

// Límite de una categoría para un mes concreto. El mes sin registro hereda el último previo (carry).
export type CategoryLimit = {
  id: string
  categoryId: string
  year: number
  month: number
  limit: Money
}

// Presupuesto del mes: límite global (cuánto puede presupuestarse en total entre las categorías de
// gasto). Una fila por usuario+mes; el mes sin registro hereda el último previo (carry), y sin
// ningún registro el límite global está "no definido" (distinto de 0). Sin FK a categorías.
export type MonthlyBudget = {
  id: string
  userId: string
  year: number
  month: number
  globalLimit: Money
}

export type Transaction = {
  id: string
  userId: string
  accountId: string
  categoryId: string | null
  date: Date
  description: string
  amount: Money
  direction: Direction
  status: MovementStatus // manual = "confirmed"; conectado según el banco
  isInternal: boolean // transferencia/pago interno: NO cuenta en presupuesto ni en el resumen
  externalId: string | null // id del movimiento en el banco; null si es manual
  // ponytail: opcional para no obligar a cada fixture/repo a declararlo; ausente = no recurrente
  recurringTemplateId?: string | null
}

// --- Inputs de escritura ---

export type NewTransaction = {
  userId: string
  accountId: string
  categoryId: string | null
  date: Date
  description: string
  amount: Money
  direction: Direction
}

export type UpdateTransaction = {
  id: string
  description: string
  date: Date
  amount: Money
  direction: Direction
  categoryId: string | null
}

export type NewBank = { userId: string; name: string }

export type NewAccount = {
  userId: string
  bankId: string
  name: string
  accountType: AccountType
  currency: CurrencyCode
  balance: Money
  overdraftLimit: Money
  color: string | null
  cardLast4: string | null
}

// --- Inputs de sincronización ---

export type CategoryInput = {
  id?: string
  userId: string
  name: string
  type: CategoryType
  icon: string | null
  color: string | null
  description: string | null
}

export type LimitInput = {
  categoryId: string
  year: number
  month: number
  limit: Money
}

export type MonthlyBudgetInput = {
  userId: string
  year: number
  month: number
  globalLimit: Money
}

// Filtros de búsqueda de movimientos (todos opcionales, se combinan con AND). `query` es texto libre
// (descripción o nombre de categoría) case-insensitive.
export type TransactionSearchFilters = {
  query?: string
  direction?: Direction
  categoryId?: string
  bankName?: string // filtra por banco: incluye TODAS las cuentas de bancos con ese nombre
  from?: Date
  to?: Date
  // Rango por monto (magnitud, la columna `amount` es positiva). Inclusive. Combinable con el resto.
  amountMin?: number
  amountMax?: number
  limit?: number
  // Triage: solo movimientos sin categoría ELEGIBLES (excluye reversed/duplicated e internos).
  // El repo mete el criterio completo al filtro, no post-filtra: el límite no se consume con
  // filas inelegibles.
  uncategorized?: boolean
}

// --- Ports (los implementa la infraestructura; aquí solo el contrato) ---

export interface BankRepository {
  listByUser(userId: string): Promise<Bank[]>
  create(input: NewBank): Promise<Bank>
  findById(id: string): Promise<Bank | null>
  // Borra el banco; la cascada de la DB elimina sus cuentas y movimientos.
  delete(bankId: string): Promise<void>
}

export interface AccountRepository {
  listByUser(userId: string): Promise<Account[]>
  findById(id: string): Promise<Account | null>
  create(input: NewAccount): Promise<Account>
  listByBank(bankId: string): Promise<Account[]>
  // Fija el saldo derivado de la proyección (cuentas conectadas: balance = caja disponible).
  setBalance(accountId: string, balance: Money): Promise<void>
}

export interface BalanceBucketRepository {
  listByUser(userId: string): Promise<BalanceBucket[]>
  listByAccount(accountId: string): Promise<BalanceBucket[]>
  // Avanza la medición de un bucket existente (proyección de un evento sobre la última medición).
  updateAmounts(
    bucketId: string,
    amounts: {
      limitAmount: Money
      used: Money
      available: Money
      asOf: Date | null
    }
  ): Promise<void>
}

export interface CategoryRepository {
  listByUser(userId: string): Promise<Category[]>
  findById(id: string): Promise<Category | null>
  upsert(input: CategoryInput): Promise<Category>
  // Todos los límites de las categorías del usuario (para calcular el efectivo con carry).
  listLimitsByUser(userId: string): Promise<CategoryLimit[]>
  setLimit(input: LimitInput): Promise<CategoryLimit>
}

export interface MonthlyBudgetRepository {
  // Todos los presupuestos del usuario (para resolver el límite global efectivo con carry).
  listByUser(userId: string): Promise<MonthlyBudget[]>
  // Upsert por (userId, year, month).
  set(input: MonthlyBudgetInput): Promise<MonthlyBudget>
}

export interface TransactionRepository {
  listByUserPeriod(
    userId: string,
    year: number,
    month: number
  ): Promise<Transaction[]>
  listByCategoryPeriod(
    categoryId: string,
    year: number,
    month: number
  ): Promise<Transaction[]>
  // Búsqueda con filtros combinados (texto insensible a mayúsculas, dirección, categoría, cuenta, fechas).
  searchByUser(
    userId: string,
    filters: TransactionSearchFilters
  ): Promise<Transaction[]>
  // Rango [min, max] de las magnitudes de monto del usuario, para acotar el slider del buscador.
  // ponytail: opcional para no obligar a los repos de test a implementarlo; hazlo requerido si
  // otro caso además de la UI lo necesita.
  amountBounds?(userId: string): Promise<{ min: number; max: number }>
  findById(id: string): Promise<Transaction | null>
  // Crea el movimiento y ajusta el saldo de la cuenta atómicamente (débito resta, crédito suma).
  create(tx: NewTransaction): Promise<Transaction>
  // Edita un movimiento manual reajustando el saldo por la diferencia (nuevo − viejo), atómico.
  update(input: UpdateTransaction): Promise<Transaction>
  // Asigna/cambia solo la categoría (permitido también en movimientos conectados; no toca el saldo).
  setCategory(
    transactionId: string,
    categoryId: string | null
  ): Promise<Transaction>
  // IA: asigna la categoría SOLO si el movimiento sigue sin categoría (escritura condicional
  // atómica). En la carrera IA↔usuario gana el usuario. Devuelve si escribió.
  setCategoryIfUncategorized(
    transactionId: string,
    categoryId: string
  ): Promise<boolean>
  // Borra un movimiento manual revirtiendo su efecto en el saldo, atómico.
  delete(transactionId: string): Promise<void>
}

// --- Errores de negocio ---

export class AccountNotFoundError extends Error {
  constructor(id: string) {
    super(`Cuenta no encontrada: ${id}`)
    this.name = "AccountNotFoundError"
  }
}

export class CategoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Categoría no encontrada: ${id}`)
    this.name = "CategoryNotFoundError"
  }
}

// El input del presupuesto del mes es inválido: monto no entero/negativo o periodo fuera de rango (→ 422).
export class InvalidMonthlyBudgetError extends Error {
  constructor(message = "Presupuesto del mes inválido") {
    super(message)
    this.name = "InvalidMonthlyBudgetError"
  }
}

// La moneda del movimiento no coincide con la de su cuenta (→ 422).
export class TransactionCurrencyMismatchError extends Error {
  constructor() {
    super("La moneda del movimiento no coincide con la de la cuenta")
    this.name = "TransactionCurrencyMismatchError"
  }
}

// Falta el número de tarjeta (últimos 4 dígitos) en una cuenta que lo exige (→ 422).
export class CardLast4RequiredError extends Error {
  constructor() {
    super(
      "La cuenta requiere los últimos 4 dígitos de la tarjeta (4 dígitos numéricos)"
    )
    this.name = "CardLast4RequiredError"
  }
}

// El actor intenta operar sobre datos que no le pertenecen (→ 404).
export class NotOwnerError extends Error {
  constructor() {
    super("El recurso no pertenece al usuario")
    this.name = "NotOwnerError"
  }
}

// Se intenta editar/mover una cuenta o movimiento conectado (solo lectura) (→ 422).
export class ConnectedAccountReadOnlyError extends Error {
  constructor() {
    super(
      "Las cuentas y movimientos conectados por el banco son de solo lectura"
    )
    this.name = "ConnectedAccountReadOnlyError"
  }
}

// La conexión con el proveedor falló (token inválido, el banco respondió error) (→ 422).
export class BankConnectionError extends Error {
  constructor(message = "No se pudo conectar con el proveedor bancario") {
    super(message)
    this.name = "BankConnectionError"
  }
}

// La firma del webhook es inválida o falta (→ 401).
export class WebhookSignatureError extends Error {
  constructor() {
    super("Firma de webhook inválida")
    this.name = "WebhookSignatureError"
  }
}
