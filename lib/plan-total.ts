// Lo que el plan del mes DERIVA antes de dibujar nada: cuánta plata ofrece repartir, si vale la
// pena ofrecer volver a seguirlo, y de qué mes viene el descuento.
//
// Vive acá y no dentro del componente porque son decisiones que tienen que moverse JUNTAS: el
// total, la condición de mostrar la sugerencia y el número que se manda a `POST /api/budgets` son
// el mismo número visto tres veces. Romper una sola de las tres deja al plan ofreciendo plata que
// ya se gastó, y dentro de un `.tsx` eso no lo agarra ningún test (el repo corre `node --test`,
// sin infraestructura de componentes).
//
// Relativo con .ts (no `@/`) a propósito, igual que `finance-format.ts`: así el módulo corre con
// `node --test`, que no resuelve el alias.
import { monthName } from "./finance-format.ts"

/**
 * Lo que queda para repartir: ingresos planificados y adicionales menos el déficit de gastos
 * frente a ingresos del período anterior. Esa diferencia ya tiene destino y no se reparte otra vez.
 *
 * Piso en 0: un presupuesto negativo no existe, y el endpoint exige un entero ≥ 0.
 */
export function planTotal(
  activeIncomeTotal: number,
  previousMonthDebt: number
): number {
  return Math.max(0, activeIncomeTotal - previousMonthDebt)
}

/**
 * ¿Se ofrece «Volver a seguir tus ingresos»? Solo si el mes tiene un tope fijado a mano (sin la
 * marca `followsIncome`). Un tope que ya sigue al ingreso se recalcula solo en cada escritura y al
 * cambiar de período, así que no hay nada que ofrecer; uno igual al total pero sin la marca sí se
 * ofrece: volver a seguir es lo que lo deja siguiendo.
 *
 * Con el total en 0 NO se ofrece, y esa es la parte que no es cosmética: significa que la deuda se
 * comió el ingreso entero, y dejar el presupuesto del mes en cero de un clic es una decisión del
 * usuario, no algo que la app deba sugerir. Ahí queda solo la explicación.
 */
export function shouldSuggest(
  total: number,
  globalLimit: number | null,
  followsIncome: boolean
): boolean {
  return globalLimit !== null && total > 0 && !followsIncome
}

/**
 * Cómo se nombra el mes anterior a (year, month) en el texto del descuento. En enero se agrega el
 * año: "en diciembre se gastó…" sin más deja pensando si es el diciembre que viene o el que pasó.
 */
export function previousMonthLabel(year: number, month: number): string {
  const name = monthName(month === 1 ? 12 : month - 1).toLowerCase()
  return month === 1 ? `${name} de ${year - 1}` : name
}
