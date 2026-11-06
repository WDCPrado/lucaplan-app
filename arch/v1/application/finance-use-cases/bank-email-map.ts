// Contrato del correo bancario: los tipos del evento que sale de un correo y los helpers de
// extracción que NO dependen del banco (HTML→texto, montos, tarjetas, cuentas, fechas, identidad).
// El parser de cada banco vive en su propio archivo y usa esto; ninguno importa al de otro banco.
//
// Todo aquí es PURO: el cuerpo del correo se procesa en memoria y no se persiste ni se registra.
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"
import type { BankEmailMessage } from "../../domain/finance/email-connection.domain.ts"
import { todayKey } from "../../../shared/today.ts"

// --- Tipos del evento extraído ---

// Instrumento referido por el correo: cuenta corriente (número completo o últimos 4), tarjeta de
// crédito (últimos 4) o la cuenta principal del vínculo. `ref` guarda solo dígitos.
//
// `primary_checking` existe porque hay plantillas que nombran la cuenta de cargo solo como "tu
// cuenta principal", sin número: el parser la refiere tal cual en vez de inventar dígitos, y quien
// resuelve contra los instrumentos confirmados decide si es inequívoca.
export type EmailInstrumentRef =
  | { kind: "checking"; ref: string }
  | { kind: "credit_card"; last4: string }
  | { kind: "primary_checking" }

// No existe una variante de ingreso, y es a propósito: del correo solo sale el gasto; toda entrada
// de dinero es ajuste de saldo interno. Ver docs/bank-email-contract.md.
export type EmailEventKind = "expense" | "internal_credit" | "internal_payment"

export type EmailEventSource =
  | "cargo_cuenta"
  | "compra_tarjeta"
  | "transferencia"
  | "transferencia_fondos"
  | "pago_tarjeta"
  | "pago_linea"
  | "pago_credito_consumo"

export type EmailEvent = {
  kind: EmailEventKind
  source: EmailEventSource
  amount: Money
  date: Date // fecha del movimiento (del cuerpo si viene; si no, el día de recepción en Chile; granularidad día)
  receivedAt: Date // instante de recepción del correo (para comparar contra el snapshot con precisión)
  description: string // sin RUT/cuentas/correos; comercio o destinatario si el correo lo informa
  instrument: EmailInstrumentRef | null // null = el correo no identifica el instrumento
  // Bucket que ajusta un pago interno inequívoco (pago tarjeta CLP/USD o pago de línea).
  paymentTarget: "credit_national" | "credit_international" | "overdraft" | null
  // Segunda pata del pago de tarjeta: débito CLP en la cuenta corriente de origen. null salvo en el
  // pago de tarjeta (nacional/internacional). El use-case lo expande a un segundo movimiento.
  cashLeg: { ref: string; amount: Money } | null
  tefId: string | null // ID TEF (identidad bancaria estable de transferencias)
  externalId: string // identidad idempotente: email:txn:<Transacción> | email:tef:<id> | email:mid:<Message-ID> | email:gid:<id Graph>
}

export type EmailSkipReason =
  | "remitente_desconocido"
  | "asunto_desconocido"
  | "sin_monto"
  | "sin_instrumento"
  | "plantilla_desconocida"
  | "abono_ignorado" // entrada de dinero: se declara en Ingresos, no se deduce del correo

export type ParsedEmail =
  | { ok: true; event: EmailEvent }
  | { ok: false; reason: EmailSkipReason }

// --- HTML → texto plano (acotado; sin ejecutar contenido ni descargar recursos) ---

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Ntilde: "Ñ",
  uuml: "ü",
  deg: "°",
  ordm: "º",
  middot: "·",
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    )
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script)[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|tr|td|th|li|h[1-6]|table)\s*>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
}

export function normalizeSubject(subject: string): string {
  return subject.replace(/\s+/g, " ").trim().toLowerCase()
}

// ¿El cargo va contra una cuenta corriente? Cubre la referida por número/últimos 4 y la cuenta
// principal del vínculo: las dos descuentan caja igual, solo cambia cómo se resuelve la cuenta.
export function isCheckingInstrument(
  instrument: EmailInstrumentRef | null
): boolean {
  return (
    instrument?.kind === "checking" || instrument?.kind === "primary_checking"
  )
}

// --- Extracción de campos (regex acotadas y tolerantes; faltante ⇒ se omite el correo) ---

// Valor que sigue a una etiqueta en las plantillas de tabla ("Monto | $1.000"). Tras htmlToText
// cada celda queda en su línea, así que el separador tolera el salto, ":", "|", "*" y los guiones
// de la fila de encabezado. `label` se interpola como fragmento de regex: sirve para tolerar
// tildes ("c[oó]digo").
export function labeled(text: string, label: string): string | null {
  const m = text.match(new RegExp(`${label}[\\s:|*-]*([^\\n]+)`, "i"))
  return m ? m[1].trim() : null
}

// CLP: "$ 1.234.567" (puntos de miles). El lookbehind evita confundir "US$".
export function parseClp(text: string): Money | null {
  const m = text.match(/(?<![A-Z])\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?!\d)/)
  if (!m) return null
  const pesos = parseInt(m[1].replace(/\./g, ""), 10)
  return Number.isFinite(pesos) && pesos > 0
    ? Money.fromMinor(pesos, "CLP")
    : null
}

// USD: "US$ 12,34" | "USD 1.234,56" | "US$1,234.56" | "USD$142,05". El último separador con 2
// dígitos es decimal.
export function parseUsd(text: string): Money | null {
  const m = text.match(/(?:US\$|USD\$?)\s*(\d[\d.,]*)/i)
  if (!m) return null
  const raw = m[1]
  const sep = Math.max(raw.lastIndexOf(","), raw.lastIndexOf("."))
  let intDigits = raw
  let frac = "00"
  if (sep !== -1) {
    const tail = raw.slice(sep + 1)
    if (tail.length === 2) {
      intDigits = raw.slice(0, sep)
      frac = tail
    } else if (tail.length !== 3) {
      return null // ni decimal (2) ni separador de miles (3): plantilla desconocida
    }
  }
  const digits = intDigits.replace(/[.,]/g, "")
  if (!/^\d+$/.test(digits)) return null
  const cents = parseInt(digits + frac, 10)
  return Number.isFinite(cents) && cents > 0
    ? Money.fromMinor(cents, "USD")
    : null
}

// Monto con su moneda: USD primero (su patrón contiene "$"), luego CLP.
export function parseAmount(text: string): Money | null {
  return parseUsd(text) ?? parseClp(text)
}

// Monto CLP de una etiqueta concreta ("Monto Pagado: $265.708"). Obligatorio en plantillas con
// varias cifras (interés, utilizado, tipo de cambio, letra chica de promociones): el primer "$" del
// texto NO es el monto de la operación.
export function parseLabeledClp(text: string, label: RegExp): Money | null {
  const m = text.match(label)
  return m ? parseClp(m[1]) : null
}

// Monto USD de una etiqueta concreta ("Monto pagado USD$142,05"). El grupo 1 incluye el prefijo
// USD$/US$ para que parseUsd lo interprete.
export function parseLabeledUsd(text: string, label: RegExp): Money | null {
  const m = text.match(label)
  return m ? parseUsd(m[1]) : null
}

// Últimos 4 de una tarjeta: "terminada en 1234", "**** 1234", "Tarjeta ... 1234".
export function parseCardLast4(text: string): string | null {
  const m =
    text.match(/terminad[ao]\s+en\s+[*•Xx\s]*(\d{4})(?!\d)/i) ??
    text.match(/[*•Xx]{2,}\s*(\d{4})(?!\d)/) ??
    text.match(/tarjeta(?:\s+de\s+cr[eé]dito)?[^\d\n]{0,40}(\d{4})(?!\d)/i)
  return m ? m[1] : null
}

// Cuenta corriente: número ("Cuenta N° 00-123-45678-09") o últimos 4 ("cuenta terminada en 1234").
// Devuelve solo dígitos; 4 dígitos ⇒ últimos 4.
export function parseAccountRef(text: string): string | null {
  const last4 = text.match(
    /cuenta[^\d\n]{0,60}terminad[ao]\s+en\s+[*•Xx\s]*(\d{4})(?!\d)/i
  )
  if (last4) return last4[1]
  const masked = text.match(/cuenta[^\d\n]{0,40}[*•Xx]{2,}\s*(\d{4})(?!\d)/i)
  if (masked) return masked[1]
  const full = text.match(
    /cuenta(?:\s+corriente|\s+vista)?\s*(?:n[°º]?|nro\.?|n[uú]mero)?\s*[:.]?\s*(\d[\d-]{3,})/i
  )
  if (full) return full[1].replace(/\D/g, "")
  return null
}

// ID TEF: "N° de operación 123456", "ID transacción: 123456", "Comprobante N° 123456".
export function parseTefId(text: string): string | null {
  const m = text.match(
    /(?:n[°º]?\s*(?:de\s*)?(?:operaci[oó]n|transacci[oó]n|comprobante)|id\s*(?:tef|de\s*)?(?:operaci[oó]n|transacci[oó]n)?)\s*[:#]?\s*(\d{5,})/i
  )
  return m ? m[1] : null
}

export function cleanupName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim()
  return name.length >= 2 ? name : null
}

// Sección de "Origen" del comprobante (acota de dónde sale la cuenta de cargo, para no confundirla
// con la cuenta o tarjeta de destino). Cubre "Datos de Origen … Datos de Destino", "Origen …
// Destino" y "Cuenta de origen … Cuenta de destino". Sin sección, se busca en todo el texto.
export function originSection(text: string): string {
  const m = text.match(
    /(?:datos de |cuenta de )?origen([\s\S]*?)(?=(?:datos de |cuenta de )?destino|$)/i
  )
  return m ? m[1] : text
}

// Fecha del movimiento en el cuerpo ("dd/mm/yyyy" o "dd-mm-yyyy"); si no viene, la de recepción.
export function parseDate(text: string, receivedAt: Date): Date {
  const m = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/)
  if (m) {
    const [, d, mo, y] = m
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
    if (!Number.isNaN(date.getTime())) return date
  }
  return dayOf(receivedAt)
}

// Día civil en Chile del instante, a medianoche UTC (`@db.Date`): un correo de las 22:00 del 4-oct
// llega el 5-oct en UTC y su cargo es del 4.
export function dayOf(instant: Date): Date {
  return new Date(`${todayKey(instant)}T00:00:00.000Z`)
}

// Identidad idempotente del movimiento: Transacción > ID TEF > Message-ID > id inmutable de Graph.
export function emailExternalId(
  txnId: string | null,
  tefId: string | null,
  internetMessageId: string | null,
  graphId: string
): string {
  if (txnId) return `email:txn:${txnId}`
  if (tefId) return `email:tef:${tefId}`
  if (internetMessageId) return `email:mid:${internetMessageId}`
  return `email:gid:${graphId}`
}

// Constructor del evento: completa receivedAt y la identidad idempotente desde el mensaje.
export function emailEvent(input: {
  kind: EmailEventKind
  source: EmailEventSource
  amount: Money
  date: Date
  description: string
  instrument: EmailInstrumentRef | null
  paymentTarget: EmailEvent["paymentTarget"]
  cashLeg?: { ref: string; amount: Money } | null
  txnId?: string | null
  tefId: string | null
  msg: BankEmailMessage
}): ParsedEmail {
  return {
    ok: true,
    event: {
      kind: input.kind,
      source: input.source,
      amount: input.amount,
      date: input.date,
      receivedAt: input.msg.receivedAt,
      description: input.description,
      instrument: input.instrument,
      paymentTarget: input.paymentTarget,
      cashLeg: input.cashLeg ?? null,
      tefId: input.tefId,
      externalId: emailExternalId(
        input.txnId ?? null,
        input.tefId,
        input.msg.internetMessageId,
        input.msg.id
      ),
    },
  }
}

// ¿La moneda corresponde a un CurrencyCode soportado? (guard para llamadores)
export function isSupportedCurrency(c: string): c is CurrencyCode {
  return c === "CLP" || c === "USD"
}
