// Dominio de fuentes de ingreso. Puro: sin Prisma, sin DB. Una fuente de ingreso mensual del usuario
// (sueldo, arriendo...), con cuenta destino (no de crédito) y categoría type=income. Alimenta la
// semilla del límite global del presupuesto y, al "generar", un movimiento (credit) del mes.

import type { AccountType } from "./finance.domain.ts"
import type { CurrencyCode, Money } from "./money.ts"

// --- Entidad ---

export type Income = {
  id: string
  userId: string
  accountId: string // cuenta destino (no credit_card/credit_line)
  categoryId: string // categoría type=income
  name: string
  currency: CurrencyCode
  dayOfMonth: number // 1–31
  isActive: boolean
  // Mes desde el que la fuente dejó de existir (inclusive); null = sigue vigente.
  endedYear: number | null
  endedMonth: number | null
}

// Monto de una fuente para un mes concreto. El mes sin registro hereda el último previo
// (carry-forward); antes del primer registro la fuente todavía no existía.
export type IncomeAmount = {
  incomeId: string
  year: number
  month: number
  amount: Money
}

// --- Inputs de escritura ---

export type NewIncome = {
  userId: string
  accountId: string
  categoryId: string
  name: string
  amount: Money
  dayOfMonth: number
  // Mes desde el que rige el monto: el que el usuario está viendo al crearla.
  year: number
  month: number
}

export type UpdateIncome = {
  id: string
  accountId: string
  categoryId: string
  name: string
  amount: Money
  dayOfMonth: number
  isActive: boolean
  // Mes que se está editando: el monto se escribe SOLO ahí (los meses previos no cambian).
  year: number
  month: number
}

// --- Reglas ---

// Una cuenta de crédito no recibe ingresos: un abono a una tarjeta es un pago, no un ingreso.
export function accountAcceptsIncome(type: AccountType): boolean {
  return type !== "credit_card" && type !== "credit_line"
}

/** Índice comparable de mes, para ordenar y comparar períodos. */
const monthIndex = (year: number, month: number) => year * 12 + (month - 1)

/** ¿La fuente ya no rige en (year, month)? Terminarla no borra los meses anteriores. */
export function isIncomeEndedAt(
  income: Pick<Income, "endedYear" | "endedMonth">,
  year: number,
  month: number
): boolean {
  if (income.endedYear === null || income.endedMonth === null) return false
  return (
    monthIndex(year, month) >=
    monthIndex(income.endedYear, income.endedMonth)
  )
}

export function isValidDayOfMonth(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= 31
}

// --- Port (lo implementa la infraestructura) ---

export interface IncomeRepository {
  listByUser(userId: string): Promise<Income[]>
  /** Montos mensuales de todas las fuentes del usuario (para resolver el efectivo por mes). */
  listAmountsByUser(userId: string): Promise<IncomeAmount[]>
  findById(id: string): Promise<Income | null>
  create(input: NewIncome): Promise<Income>
  update(input: UpdateIncome): Promise<Income>
  /** Borra la fuente por completo. Solo cuando no tiene historia que conservar. */
  delete(id: string): Promise<void>
  /** Marca el fin de vigencia: deja de existir desde (year, month), sin tocar los meses previos. */
  endFrom(id: string, year: number, month: number): Promise<void>
  // ¿Existe ya un movimiento generado desde esta fuente en (year, month)? (para la UI "no generadas").
  hasGeneratedFor(
    incomeId: string,
    year: number,
    month: number
  ): Promise<boolean>
  // Crea el movimiento de ingreso del mes (credit) en la cuenta destino, vinculado a la fuente
  // (incomeId), ajustando el saldo. Idempotente y atómico (check-then-insert en una transacción DB):
  // si ya existe uno para (income, year, month) lo devuelve sin crear otro. `created` indica si escribió.
  generateMonthly(
    income: Income,
    year: number,
    month: number
  ): Promise<{ transactionId: string; created: boolean }>
  // Deshace la generación: borra el movimiento de (income, year, month) y revierte el saldo con el
  // monto REAL del movimiento (no el de la fuente, que pudo cambiarse). Atómico. `deleted` = si había uno.
  // Permitido aunque la cuenta destino sea conectada (es la inversa de generar, no una edición libre).
  ungenerateMonthly(
    incomeId: string,
    year: number,
    month: number
  ): Promise<{ deleted: boolean }>
}

// --- Errores de negocio ---

// El input de una fuente de ingreso es inválido: monto ≤ 0, día fuera de 1–31, cuenta de crédito,
// o moneda que no coincide con la de la cuenta destino (→ 422).
export class InvalidIncomeError extends Error {
  constructor(message = "Fuente de ingreso inválida") {
    super(message)
    this.name = "InvalidIncomeError"
  }
}

export class IncomeNotFoundError extends Error {
  constructor(id: string) {
    super(`Fuente de ingreso no encontrada: ${id}`)
    this.name = "IncomeNotFoundError"
  }
}
