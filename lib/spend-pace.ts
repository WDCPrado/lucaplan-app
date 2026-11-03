/**
 * Curva de gasto contra el ritmo ideal del Inicio. El eje va por bordes de día: el punto `k` es el
 * fin del día `k` (0 = antes del primer día), así las dos líneas arrancan en $0 y el ideal llega al
 * presupuesto justo al cierre.
 *
 * - `spend`: gasto de cada fecha del período (`globalPace.daily` de la vista del presupuesto), en orden.
 * - `lastIndex`: último día con datos (hoy en el mes en curso, el último en un mes pasado, -1 si el
 *   período aún no empieza).
 */
export function spendPace(spend: number[], limit: number, lastIndex: number) {
  const n = spend.length
  const ideal = Array.from({ length: n + 1 }, (_, k) =>
    n ? (limit * k) / n : 0
  )
  const cumulative = [0]
  for (let i = 0; i <= Math.min(lastIndex, n - 1); i++)
    cumulative.push(cumulative[i] + spend[i])
  const k = cumulative.length - 1
  // > 0: sobre el ritmo; < 0: bajo el ritmo. Redondeado a peso: es lo que se lee.
  const diff = Math.round(cumulative[k] - ideal[k])
  return { ideal, cumulative, diff }
}
