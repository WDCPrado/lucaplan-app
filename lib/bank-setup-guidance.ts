// Qué se le dice al usuario en la revisión previa a crear un banco conectado por correo, qué se le
// propone y qué le falta para poder confirmarla. Vive acá —y no dentro del componente— porque son
// decisiones con reglas, y así se prueban sin montar la UI (mismo patrón que lib/import-progress.ts).
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

/** Una tarjeta del formulario: sus últimos 4 y qué cupos dejó encendidos el usuario. */
export type SetupCard = {
  ref: string
  national: boolean
  international: boolean
}

/** Lo que hay en el formulario de confirmación: `checkingRef` null = no hay cuenta corriente. */
export type SetupForm = {
  checkingRef: string | null
  cards: SetupCard[]
}

function refsIncompletos({ checkingRef, cards }: SetupForm): boolean {
  return (
    (checkingRef !== null && !refComplete(checkingRef)) ||
    cards.some((card) => !refComplete(card.ref))
  )
}

const FALTAN_DIGITOS = "Escribe los últimos 4 dígitos de cada cuenta y tarjeta."

/**
 * Lo que impide confirmar la conexión inicial, en las palabras del usuario. `null` = se puede
 * importar. Los tres casos terminan en el mismo error del servidor, y ese error solo aparecía
 * después del overlay de importación: acá se dicen antes, con el botón apagado.
 */
export function confirmBlocker(form: SetupForm): string | null {
  if (form.checkingRef === null && form.cards.length === 0)
    return "Agrega tu cuenta corriente o tu tarjeta para poder importar."
  if (refsIncompletos(form)) return FALTAN_DIGITOS
  // Una tarjeta sin ningún cupo no se puede crear: no tendría bucket que llevar la deuda.
  if (form.cards.some((card) => !card.national && !card.international))
    return "Enciende el cupo nacional o el internacional de cada tarjeta."
  return null
}

/**
 * Lo que impide actualizar saldos. Solo mira las referencias, que es con lo que se resuelve contra
 * qué cuenta escribir: apagar un cupo acá significa "este no lo actualices", que es legítimo.
 *
 * Con la referencia vacía, `reconcileEmailBalances` resuelve por `endsWith("")` —verdadero para
 * cualquier cuenta— y sobrescribe el saldo de la primera cuenta corriente que encuentre.
 */
export function reconcileBlocker(form: SetupForm): string | null {
  return refsIncompletos(form) ? FALTAN_DIGITOS : null
}

/** Un candidato de instrumento, tal como lo devuelve el escaneo. */
export type ScanCandidate =
  | { kind: "checking"; ref: string; last4: string; movementCount: number }
  | {
      kind: "credit_card"
      last4: string
      currencies: ("CLP" | "USD")[]
      movementCount: number
    }

/**
 * La cuenta corriente que se le propone al usuario, o `null` si no hay ninguna que proponer.
 *
 * El caso que resuelve WDC-65: sin candidato numerado pero con movimientos contra "tu cuenta
 * principal", se propone igual una cuenta VACÍA. Los dígitos no se inventan —el correo no los
 * trae—, pero dejar el formulario en blanco escondía que esos movimientos dependen de que el
 * usuario la agregue.
 */
export function proposedChecking(scan: {
  candidates: readonly ScanCandidate[]
  primaryCheckingCount: number
}): { ref: string; movementCount: number } | null {
  const numerada = scan.candidates.find((c) => c.kind === "checking")
  if (numerada)
    return { ref: numerada.ref, movementCount: numerada.movementCount }
  if (scan.primaryCheckingCount > 0)
    return { ref: "", movementCount: scan.primaryCheckingCount }
  return null
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
  { checkingRef, cards }: SetupForm
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
  if (checkingRef !== null || cards.length > 0) return null
  if (scan.totalMessages === 0)
    return (
      `Todavía no hay avisos de ${scan.bankName} en este correo. Agrega igual tu cuenta o ` +
      `tarjeta: los movimientos que lleguen después quedan asociados.`
    )
  const ninguno =
    scan.totalMessages === 1
      ? "El único correo revisado no identifica"
      : `Ninguno de los ${scan.totalMessages} correos revisados identifica`
  return (
    `${ninguno} una cuenta o tarjeta de ${scan.bankName}. Agrégala con sus últimos 4 dígitos ` +
    `para que sus movimientos se importen.`
  )
}

/** "1 gasto" / "2 gastos": el conteo va en el texto, así que el plural también. */
export function plural(n: number, singular: string, varios: string): string {
  return `${n} ${n === 1 ? singular : varios}`
}
