// Qué se le dice al usuario en la revisión previa a crear un banco conectado por correo, y qué le
// falta para poder confirmarla. Vive acá —y no dentro del componente— porque son decisiones de
// texto con reglas, y así se prueban sin montar la UI (mismo patrón que lib/import-progress.ts).
//
// El caso que las hizo necesarias: hay bancos cuyos avisos de transferencia no numeran la cuenta
// ("tu cuenta principal"), así que el escaneo termina sin nada que proponer y el formulario llegaba
// vacío, como si la app hubiera fallado.

/**
 * El servidor exige al menos 4 dígitos para crear la cuenta o la tarjeta (`confirmEmailSetup`).
 * Sin esta comprobación en el formulario, el error aparecía recién después del overlay de
 * importación, cuando ya no se entiende de dónde viene.
 */
export function refComplete(value: string): boolean {
  return value.replace(/\D/g, "").length >= 4
}

/** Lo que hay en el formulario de confirmación: `checkingRef` null = no hay cuenta corriente. */
export type SetupForm = {
  checkingRef: string | null
  cardRefs: string[]
}

/** Lo que impide confirmar la conexión, en las palabras del usuario. `null` = se puede importar. */
export function confirmBlocker({
  checkingRef,
  cardRefs,
}: SetupForm): string | null {
  if (checkingRef === null && cardRefs.length === 0)
    return "Agrega tu cuenta corriente o tu tarjeta para poder importar."
  const incompleto =
    (checkingRef !== null && !refComplete(checkingRef)) ||
    cardRefs.some((ref) => !refComplete(ref))
  return incompleto
    ? "Escribe los últimos 4 dígitos de cada cuenta y tarjeta."
    : null
}

/** Lo que el escaneo encontró, sin los candidatos: solo lo que hace falta para explicarlo. */
export type ScanFacts = {
  bankName: string
  totalMessages: number
  // Movimientos que el banco refiere solo como "tu cuenta principal", sin número.
  primaryCheckingCount: number
}

/**
 * El aviso que explica la revisión: por qué llega así y qué tiene que hacer el usuario. `null`
 * cuando el escaneo se explica solo (hay instrumentos propuestos y nada en riesgo).
 *
 * Se decide contra el formulario en curso, no solo contra el escaneo: si el usuario quita la cuenta
 * propuesta, el aviso vuelve, porque los movimientos sin número vuelven a quedar sin destino.
 */
export function scanGuidance(
  scan: ScanFacts,
  { checkingRef, cardRefs }: SetupForm
): string | null {
  // Los movimientos sin número se importan solo si termina existiendo UNA cuenta corriente
  // confirmada: mientras le falten los últimos 4, hay algo concreto en juego.
  if (
    scan.primaryCheckingCount > 0 &&
    (checkingRef === null || !refComplete(checkingRef))
  ) {
    const movs = plural(scan.primaryCheckingCount, "movimiento", "movimientos")
    return (
      `${scan.bankName} no escribe el número de cuenta en ${movs}: sus avisos dicen solo ` +
      `«tu cuenta principal». Completa los últimos 4 de tu tarjeta de débito y quedan asociados. ` +
      `Sin una cuenta confirmada esos movimientos se omiten y no se categorizan.`
    )
  }
  if (checkingRef !== null || cardRefs.length > 0) return null
  if (scan.totalMessages === 0)
    return (
      `Todavía no hay avisos de ${scan.bankName} en este correo. Agrega igual tu cuenta o ` +
      `tarjeta: los movimientos que lleguen después quedan asociados.`
    )
  return (
    `Ninguno de los ${scan.totalMessages} correos revisados identifica una cuenta o tarjeta de ` +
    `${scan.bankName}. Agrégala con sus últimos 4 dígitos para que sus movimientos se importen.`
  )
}

/** "1 gasto" / "2 gastos": el conteo va en el texto, así que el plural también. */
export function plural(n: number, singular: string, varios: string): string {
  return `${n} ${n === 1 ? singular : varios}`
}
