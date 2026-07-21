// Tipo de cambio para llevar montos en otra moneda a CLP (la base de presupuesto y cálculos).
// El rate viene de infraestructura (dólar observado por fecha); el dominio solo define el contrato
// y la conversión pura. El CLP resultante es un ESTIMADO: el banco factura con su propio cambio.
import { Money } from "./money.ts"

export interface ExchangeRateProvider {
  // CLP por 1 USD en la fecha dada (dólar observado; el día hábil más cercano si es finde/feriado).
  clpPerUsdAt(date: Date): Promise<number>
}

// Convierte un monto a CLP con el rate dado (CLP por unidad de la moneda). Los CLP pasan intactos.
// CLP no tiene decimales: Money.of redondea al peso.
export function toClp(amount: Money, clpPerUnit: number): Money {
  if (amount.currency === "CLP") return amount
  return Money.of(amount.toMajor() * clpPerUnit, "CLP")
}
