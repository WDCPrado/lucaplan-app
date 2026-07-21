// Búsqueda por monto. La columna `amount` guarda la MAGNITUD positiva (el signo lo lleva
// `direction`), así que todo aquí opera sobre magnitudes.
//
// Prefijo = lado izquierdo escrito; el resto es comodín. "1299" matchea 1299, 12990–12999,
// 129900–129999, … es decir, todo entero cuya representación decimal EMPIEZA con esos dígitos.
// Se traduce a una unión de rangos [v·10^k, (v+1)·10^k) para comparar contra la columna numérica
// sin operaciones de texto.

/** Solo los dígitos de un texto: quita puntos, comas, símbolos y espacios. "$12.990" → "12990". */
export function amountDigits(s: string): string {
  return s.replace(/\D/g, "")
}

// ponytail: techo de 12 dígitos (hasta billones CLP); acota la unión de rangos y evita v·10^k
// fuera del entero seguro de JS.
const MAX_DIGITS = 12

/**
 * Rangos `[gte, lt)` sobre la magnitud del monto que matchean el prefijo de dígitos. Vacío si
 * `digits` está vacío, excede el techo, o tiene ceros a la izquierda (ningún entero > 0 empieza con 0).
 */
export function amountPrefixRanges(
  digits: string
): { gte: number; lt: number }[] {
  if (!digits || digits.length > MAX_DIGITS) return []
  if (digits.length > 1 && digits[0] === "0") return []
  const v = Number(digits)
  const ranges: { gte: number; lt: number }[] = []
  for (let total = digits.length; total <= MAX_DIGITS; total++) {
    const p = 10 ** (total - digits.length)
    ranges.push({ gte: v * p, lt: (v + 1) * p })
  }
  return ranges
}
