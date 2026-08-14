// Parser PURO de notificaciones de correo de MACHBANK → evento financiero de dominio.
// Mismo contrato que el resto de bancos (docs/bank-email-contract.md): fail-closed, sin persistir
// nada del correo, y del correo nunca sale una entrada de dinero.
//
// MACHBANK es SOLO DÉBITO aquí: una cuenta principal CLP con su tarjeta Visa Débito. Ninguna
// plantilla produce crédito, cuotas, cupo internacional ni sobregiro — el único bucket que nace de
// este adapter es `cash`. Una compra en dólares se cobra en pesos: el gasto es el "Monto CLP".
//
// Dos de las tres plantillas nombran el origen solo como "tu cuenta principal MACHBANK", sin
// número: van con la referencia `primary_checking`, que se resuelve fuera del parser.
import type { BankEmailMessage } from "../../domain/finance/email-connection.domain.ts"
import {
  cleanupName,
  emailEvent,
  htmlToText,
  labeled,
  normalizeSubject,
  parseClp,
  parseDate,
  type ParsedEmail,
} from "./bank-email-map.ts"

// --- Allowlist ---

// Los tres remitentes reales. `contacto@` manda también marketing: el fail-closed no está en el
// remitente sino en exigir asunto de la allowlist MÁS confirmación en el cuerpo.
// `noreply@somosmach.com` (dominio anterior de MACH) solo trae abonos; entra para descartarlos con
// su motivo propio en vez de que cuenten como correos ajenos al buzón.
export const MACHBANK_SENDERS = [
  "no-reply@mail.machbank.cl",
  "contacto@mail.machbank.cl",
  "noreply@somosmach.com",
]

const SUBJECT_TRANSFERENCIA_PREFIX = "realizaste una transferencia a "
// El asunto real termina con un emoji ("Tu compra con MACHBANK 📲"): se compara por prefijo para
// que cambiarlo o quitarlo no rompa el adapter.
const SUBJECT_COMPRA_PREFIX = "tu compra con machbank"
const SUBJECT_PAGO_PREFIX = "le pagaste a "
// Plata que entra: se reconoce para descartarla. Ver la regla universal del contrato.
const SUBJECT_ABONO_PREFIX = "recibiste una transferencia de "

// --- Extracción de estas plantillas ---

// Dígitos de un identificador ("**154107477946**" → "154107477946"). Null si no hay suficientes:
// sin identidad estable se cae al fallback de correo, que también es válido.
function idDigits(raw: string | null, min: number): string | null {
  const digits = raw?.replace(/\D/g, "") ?? ""
  return digits.length >= min ? digits : null
}

// Nombre que sigue al prefijo del asunto, que es más estable que la maqueta del cuerpo.
function nameAfterPrefix(subject: string, prefixLength: number): string | null {
  return cleanupName(subject.trim().slice(prefixLength))
}

// --- Parser principal ---

export function parseMachbankEmail(msg: BankEmailMessage): ParsedEmail {
  if (!MACHBANK_SENDERS.includes(msg.from.trim().toLowerCase()))
    return { ok: false, reason: "remitente_desconocido" }

  const subject = normalizeSubject(msg.subject)
  const text = htmlToText(msg.htmlBody)
  const date = parseDate(text, msg.receivedAt)

  // Transferencia enviada a un tercero desde la cuenta principal.
  if (subject.startsWith(SUBJECT_TRANSFERENCIA_PREFIX)) {
    // El aviso de la transferencia RECIBIDA usa la misma maqueta: lo que las separa es el verbo
    // ("Acabas de hacer" vs "Acabas de recibir") y el origen declarado. Sin las dos confirmaciones
    // no se procesa: el instrumento que se emite sale de esa frase, no de un número.
    if (
      !/acabas de hacer una transferencia/i.test(text) ||
      !/cuenta principal/i.test(text)
    )
      return { ok: false, reason: "plantilla_desconocida" }
    const amount = parseClp(labeled(text, "monto") ?? "")
    if (!amount) return { ok: false, reason: "sin_monto" }
    const destinatario = nameAfterPrefix(
      msg.subject,
      SUBJECT_TRANSFERENCIA_PREFIX.length
    )
    return emailEvent({
      date,
      txnId: idDigits(labeled(text, "c[oó]digo de confirmaci[oó]n"), 6),
      tefId: null,
      kind: "expense",
      source: "transferencia",
      amount,
      // Del destinatario solo el nombre: ni RUT, ni banco, ni su cuenta.
      description: destinatario
        ? `Transferencia a ${destinatario}`
        : "Transferencia a terceros",
      instrument: { kind: "primary_checking" },
      paymentTarget: null,
      msg,
    })
  }

  // Compra con la tarjeta Visa Débito: cargo en la cuenta corriente de esa tarjeta.
  if (subject.startsWith(SUBJECT_COMPRA_PREFIX)) {
    if (!/visa\s+d[eé]bito/i.test(text))
      return { ok: false, reason: "plantilla_desconocida" }
    // "Monto CLP" es lo cobrado. La plantilla trae antes "Monto (moneda original) $ 1 USD" y al pie
    // "un cargo de $500 a $1.500 para validar tu tarjeta": el primer "$" del texto NO es el monto.
    const amount = parseClp(labeled(text, "monto clp") ?? "")
    if (!amount) return { ok: false, reason: "sin_monto" }
    const last4 = idDigits(
      labeled(text, "[uú]ltimos 4 d[ií]gitos de la tarjeta"),
      4
    )
    if (!last4) return { ok: false, reason: "sin_instrumento" }
    const comercio = cleanupName(labeled(text, "comercio") ?? "")
    return emailEvent({
      date,
      txnId: idDigits(labeled(text, "identificador visa"), 6),
      tefId: null,
      kind: "expense",
      source: "cargo_cuenta",
      amount,
      description: comercio ?? "Compra con tarjeta de débito",
      // La tarjeta de débito pertenece a la cuenta corriente: se refiere la cuenta por esos
      // últimos 4, nunca una tarjeta de crédito.
      instrument: { kind: "checking", ref: last4.slice(-4) },
      paymentTarget: null,
      msg,
    })
  }

  // Pago directo a una persona desde la cuenta principal.
  if (subject.startsWith(SUBJECT_PAGO_PREFIX)) {
    // La plantilla es "Le pagaste <monto> a <destinatario>": se exige entera, no basta con que el
    // cuerpo empiece con "Le pagaste". El destinatario sale del asunto; el cuerpo lo confirma.
    const linea = text.match(/le pagaste\s+([^\n]+?)\s+a\s+\S/i)
    if (!linea) return { ok: false, reason: "plantilla_desconocida" }
    const amount = parseClp(linea[1])
    if (!amount) return { ok: false, reason: "sin_monto" }
    const destinatario = nameAfterPrefix(
      msg.subject,
      SUBJECT_PAGO_PREFIX.length
    )
    return emailEvent({
      // Esta plantilla no trae fecha ni identificador propios: fecha de recepción e identidad de
      // correo (Message-ID → id de Graph), el fallback que ya usa el contrato.
      date,
      txnId: null,
      tefId: null,
      kind: "expense",
      source: "transferencia",
      amount,
      description: destinatario ? `Pago a ${destinatario}` : "Pago a terceros",
      instrument: { kind: "primary_checking" },
      paymentTarget: null,
      msg,
    })
  }

  if (subject.startsWith(SUBJECT_ABONO_PREFIX))
    return { ok: false, reason: "abono_ignorado" }
  // Todo lo demás de estos remitentes —promociones incluidas— no crea movimiento.
  return { ok: false, reason: "asunto_desconocido" }
}
