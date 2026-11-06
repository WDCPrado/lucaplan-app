import { getBudgetPeriod, type BudgetPeriodDeps } from "./budget-period-use-cases.ts"
import {
  InvalidMonthlyBudgetError,
  type MonthlyBudget,
  type MonthlyBudgetRepository,
} from "../../domain/finance/finance.domain.ts"
import { Money } from "../../domain/finance/money.ts"

const CLP = "CLP" as const

// Define el límite global del presupuesto de un mes (upsert por usuario+año+mes). La validación va
// ANTES de construir Money: Money.of redondea, y un decimal debe rechazarse, no redondearse.
export async function setMonthlyBudget(
  deps: { monthlyBudgets: MonthlyBudgetRepository } & BudgetPeriodDeps,
  userId: string,
  // followIncome: lo pone «Igualar al ingreso»; sin él (o false) el tope queda fijado a mano.
  input: { year: number; month: number; globalLimit: number; followIncome?: boolean }
): Promise<MonthlyBudget> {
  const { year, month, globalLimit } = input
  if (!Number.isInteger(globalLimit) || globalLimit < 0)
    throw new InvalidMonthlyBudgetError(
      "El límite global debe ser un monto CLP entero ≥ 0"
    )
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new InvalidMonthlyBudgetError("Mes inválido (1–12)")
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new InvalidMonthlyBudgetError("Año inválido")
  return deps.monthlyBudgets.set({
    mode: (await getBudgetPeriod(deps)).mode,
    userId,
    year,
    month,
    globalLimit: Money.of(globalLimit, CLP),
    followsIncome: input.followIncome === true,
  })
}
