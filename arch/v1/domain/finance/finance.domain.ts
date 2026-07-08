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
};

// Presupuesto = grupo de categorías, por mes. Controla sus categorías.
export type Budget = {
  id: string;
  userId: string;
  name: string;
  year: number;
  month: number;
};

export type Category = {
  id: string;
  budgetId: string;
  name: string;
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

// --- Ports (los implementa la infraestructura; aquí solo el contrato) ---

export interface BankRepository {
  listByUser(userId: string): Promise<Bank[]>;
}

export interface AccountRepository {
  listByUser(userId: string): Promise<Account[]>;
}

export interface BudgetRepository {
  findById(id: string): Promise<Budget | null>;
  listCategories(budgetId: string): Promise<Category[]>;
}

export interface TransactionRepository {
  listByUserPeriod(userId: string, year: number, month: number): Promise<Transaction[]>;
}

// --- Errores de negocio ---

export class BudgetNotFoundError extends Error {
  constructor(id: string) {
    super(`Presupuesto no encontrado: ${id}`);
    this.name = "BudgetNotFoundError";
  }
}
