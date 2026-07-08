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

export const DIRECTIONS = ["debit", "credit"] as const;
export type Direction = (typeof DIRECTIONS)[number];

// Estado de una categoría según cuánto de su límite se usó.
export const CATEGORY_STATUSES = ["bueno", "moderado", "completado", "excedido"] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

// --- Entidades ---

export type Bank = {
  id: string;
  userId: string;
  name: string;
  isActive: boolean;
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
};

// Categoría GLOBAL del usuario, compartida entre todos los meses. El límite NO vive aquí.
export type Category = {
  id: string;
  userId: string;
  name: string;
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
};

export type CategoryInput = {
  id?: string;
  userId: string;
  name: string;
  icon: string | null;
  color: string | null;
};

export type LimitInput = { categoryId: string; year: number; month: number; limit: Money };

// --- Ports (los implementa la infraestructura; aquí solo el contrato) ---

export interface BankRepository {
  listByUser(userId: string): Promise<Bank[]>;
  create(input: NewBank): Promise<Bank>;
}

export interface AccountRepository {
  listByUser(userId: string): Promise<Account[]>;
  findById(id: string): Promise<Account | null>;
  create(input: NewAccount): Promise<Account>;
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
  // Crea el movimiento y ajusta el saldo de la cuenta atómicamente (débito resta, crédito suma).
  create(tx: NewTransaction): Promise<Transaction>;
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

// El actor intenta operar sobre datos que no le pertenecen (→ 404).
export class NotOwnerError extends Error {
  constructor() {
    super("El recurso no pertenece al usuario");
    this.name = "NotOwnerError";
  }
}
