// Dominio financiero. Puro: sin Prisma, sin DB, sin Next. Entidades + enums + ports.
// Los montos usan el value object Money (ver money.ts): enteros por moneda, sin float,
// y prohíbe mezclar CLP/USD. La caja activa, el uso por categoría y el estado se derivan
// por fórmula (arch/v1/application/finance-use-cases), no son campos ni tablas.

import type { CurrencyCode, Money } from "./money.ts";

// --- Enums de dominio ---

export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "credit_card",
  "credit_line",
  "wallet",
  "investment",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

// Tipos de cuenta con tarjeta física: exigen últimos 4 dígitos y tienen arte de tarjeta.
export const CARD_ACCOUNT_TYPES = ["checking", "credit_card"] as const;

// ¿Este tipo de cuenta tiene tarjeta? (checking = débito, credit_card = crédito).
export function accountHasCard(t: AccountType): boolean {
  return t === "checking" || t === "credit_card";
}

// Variante de tarjeta por tipo, para resolver el arte: "debito" | "credito" | null (sin tarjeta).
export function cardVariant(t: AccountType): "debito" | "credito" | null {
  if (t === "checking") return "debito";
  if (t === "credit_card") return "credito";
  return null;
}

export const DIRECTIONS = ["debit", "credit"] as const;
export type Direction = (typeof DIRECTIONS)[number];

// Origen de un banco/cuenta/movimiento: creado a mano o agregado por Fintoc.
export const PROVIDERS = ["manual", "fintoc"] as const;
export type Provider = (typeof PROVIDERS)[number];

// Estado del movimiento reportado por el proveedor. Solo `confirmed` cuenta para caja/presupuesto.
export const MOVEMENT_STATUSES = ["confirmed", "pending", "reversed", "duplicated"] as const;
export type MovementStatus = (typeof MOVEMENT_STATUSES)[number];

// Estado de una categoría según cuánto de su límite se usó.
export const CATEGORY_STATUSES = ["bueno", "moderado", "completado", "excedido"] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

// Tipo de categoría: clasifica ingresos o gastos. Una categoría solo aplica a movimientos de su
// lado (income ↔ credit, expense ↔ debit); no se mezclan.
export const CATEGORY_TYPES = ["income", "expense"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

// Tipo de categoría que corresponde a una dirección de movimiento.
export function categoryTypeForDirection(direction: Direction): CategoryType {
  return direction === "credit" ? "income" : "expense";
}

// --- Entidades ---

export type Bank = {
  id: string;
  userId: string;
  name: string;
  isActive: boolean;
  provider: Provider; // "manual" | "fintoc"
  externalLinkId: string | null; // id del Link de Fintoc (link_...)
  linkToken: string | null; // token secreto del Link para leer sus datos (nunca al cliente)
  lastSyncedAt: Date | null;
};

export type Account = {
  id: string;
  userId: string;
  bankId: string;
  name: string;
  accountType: AccountType;
  currency: CurrencyCode;
  balance: Money; // puede ser negativo en checking (sobregiro usado = deuda)
  overdraftLimit: Money;
  color: string | null; // presentación
  cardLast4: string | null; // últimos 4 dígitos de la tarjeta; obligatorio en tipos con tarjeta (checking/credit_card)
  provider: Provider; // "manual" | "fintoc"; las fintoc son de solo lectura
  externalId: string | null; // id de la cuenta en Fintoc (acc_...)
};

// Categoría GLOBAL del usuario, compartida entre todos los meses. El límite NO vive aquí.
export type Category = {
  id: string;
  userId: string;
  name: string;
  type: CategoryType; // "income" (ingreso) | "expense" (gasto)
  icon: string | null; // presentación (icono lucide o emoji)
  color: string | null; // presentación
};

// Límite de una categoría para un mes concreto. El mes sin registro hereda el último previo (carry).
export type CategoryLimit = {
  id: string;
  categoryId: string;
  year: number;
  month: number;
  limit: Money;
};

export type Transaction = {
  id: string;
  userId: string;
  accountId: string;
  categoryId: string | null;
  date: Date;
  description: string;
  amount: Money;
  direction: Direction;
  status: MovementStatus; // manual = "confirmed"; fintoc según el proveedor
  externalId: string | null; // id del movimiento en Fintoc (mov_...); null si es manual
};

// --- Inputs de escritura ---

export type NewTransaction = {
  userId: string;
  accountId: string;
  categoryId: string | null;
  date: Date;
  description: string;
  amount: Money;
  direction: Direction;
};

export type UpdateTransaction = {
  id: string;
  description: string;
  date: Date;
  amount: Money;
  direction: Direction;
  categoryId: string | null;
};

export type NewBank = { userId: string; name: string };

export type NewAccount = {
  userId: string;
  bankId: string;
  name: string;
  accountType: AccountType;
  currency: CurrencyCode;
  balance: Money;
  overdraftLimit: Money;
  color: string | null;
  cardLast4: string | null;
};

// --- Inputs de sincronización (Fintoc) ---

export type ConnectedBankInput = {
  userId: string;
  name: string;
  externalLinkId: string; // link_...
  linkToken: string; // token secreto del Link (nunca al cliente)
};

export type ConnectedAccountInput = {
  userId: string;
  bankId: string;
  externalId: string; // acc_...
  name: string;
  accountType: AccountType;
  currency: CurrencyCode;
  balance: Money; // saldo reportado por el proveedor (autoritativo)
  overdraftLimit: Money;
  cardLast4: string | null;
};

export type ImportMovement = {
  externalId: string; // mov_...
  date: Date;
  description: string;
  amount: Money;
  direction: Direction;
  status: MovementStatus;
};

export type CategoryInput = {
  id?: string;
  userId: string;
  name: string;
  type: CategoryType;
  icon: string | null;
  color: string | null;
};

export type LimitInput = { categoryId: string; year: number; month: number; limit: Money };

// --- Ports (los implementa la infraestructura; aquí solo el contrato) ---

export interface BankRepository {
  listByUser(userId: string): Promise<Bank[]>;
  create(input: NewBank): Promise<Bank>;
  findById(id: string): Promise<Bank | null>;
  // Sistema (webhook): localiza el banco por el id del Link, sin userId. Null si no existe.
  findByExternalLinkId(externalLinkId: string): Promise<Bank | null>;
  // Fintoc: crea o actualiza el banco conectado por (userId, externalLinkId).
  upsertConnected(input: ConnectedBankInput): Promise<Bank>;
  // Borra el banco; la cascada de la DB elimina sus cuentas y movimientos.
  delete(bankId: string): Promise<void>;
}

export interface AccountRepository {
  listByUser(userId: string): Promise<Account[]>;
  findById(id: string): Promise<Account | null>;
  create(input: NewAccount): Promise<Account>;
  listByBank(bankId: string): Promise<Account[]>;
  // Fintoc: crea o actualiza la cuenta conectada por (userId, externalId); saldo del proveedor.
  upsertConnected(input: ConnectedAccountInput): Promise<Account>;
}

export interface CategoryRepository {
  listByUser(userId: string): Promise<Category[]>;
  findById(id: string): Promise<Category | null>;
  upsert(input: CategoryInput): Promise<Category>;
  // Todos los límites de las categorías del usuario (para calcular el efectivo con carry).
  listLimitsByUser(userId: string): Promise<CategoryLimit[]>;
  setLimit(input: LimitInput): Promise<CategoryLimit>;
}

export interface TransactionRepository {
  listByUserPeriod(userId: string, year: number, month: number): Promise<Transaction[]>;
  listByCategoryPeriod(categoryId: string, year: number, month: number): Promise<Transaction[]>;
  findById(id: string): Promise<Transaction | null>;
  // Crea el movimiento y ajusta el saldo de la cuenta atómicamente (débito resta, crédito suma).
  create(tx: NewTransaction): Promise<Transaction>;
  // Edita un movimiento manual reajustando el saldo por la diferencia (nuevo − viejo), atómico.
  update(input: UpdateTransaction): Promise<Transaction>;
  // Asigna/cambia solo la categoría (permitido también en movimientos fintoc; no toca el saldo).
  setCategory(transactionId: string, categoryId: string | null): Promise<Transaction>;
  // Borra un movimiento manual revirtiendo su efecto en el saldo, atómico.
  delete(transactionId: string): Promise<void>;
  // Fintoc: importa movimientos por upsert (accountId, externalId), preservando la categoría
  // asignada; NO ajusta el saldo (lo fija el proveedor). Idempotente.
  importMovements(userId: string, accountId: string, movements: ImportMovement[]): Promise<void>;
}

// --- Errores de negocio ---

export class AccountNotFoundError extends Error {
  constructor(id: string) {
    super(`Cuenta no encontrada: ${id}`);
    this.name = "AccountNotFoundError";
  }
}

export class CategoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Categoría no encontrada: ${id}`);
    this.name = "CategoryNotFoundError";
  }
}

// La moneda del movimiento no coincide con la de su cuenta (→ 422).
export class TransactionCurrencyMismatchError extends Error {
  constructor() {
    super("La moneda del movimiento no coincide con la de la cuenta");
    this.name = "TransactionCurrencyMismatchError";
  }
}

// Falta el número de tarjeta (últimos 4 dígitos) en una cuenta que lo exige (→ 422).
export class CardLast4RequiredError extends Error {
  constructor() {
    super("La cuenta requiere los últimos 4 dígitos de la tarjeta (4 dígitos numéricos)");
    this.name = "CardLast4RequiredError";
  }
}

// El actor intenta operar sobre datos que no le pertenecen (→ 404).
export class NotOwnerError extends Error {
  constructor() {
    super("El recurso no pertenece al usuario");
    this.name = "NotOwnerError";
  }
}

// Se intenta editar/mover una cuenta o movimiento de origen `fintoc` (solo lectura) (→ 422).
export class ConnectedAccountReadOnlyError extends Error {
  constructor() {
    super("Las cuentas y movimientos conectados por Fintoc son de solo lectura");
    this.name = "ConnectedAccountReadOnlyError";
  }
}

// La conexión con el proveedor falló (token inválido, Fintoc respondió error) (→ 422).
export class BankConnectionError extends Error {
  constructor(message = "No se pudo conectar con el proveedor bancario") {
    super(message);
    this.name = "BankConnectionError";
  }
}

// La firma del webhook de Fintoc es inválida o falta (→ 401).
export class WebhookSignatureError extends Error {
  constructor() {
    super("Firma de webhook inválida");
    this.name = "WebhookSignatureError";
  }
}
