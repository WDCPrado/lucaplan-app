// Parser PURO de notificaciones de correo de Banco de Chile → evento financiero de dominio.
// Fail-closed: solo remitentes y asuntos de la allowlist producen eventos; cualquier otro correo, o
// una plantilla permitida a la que le falte un dato obligatorio (monto/instrumento), se OMITE con
// un motivo sin contenido sensible. El cuerpo HTML se procesa solo en memoria: aquí no se persiste
// ni se registra nada del correo. Sin dependencias de parseo (regex acotadas sobre el texto).
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"
import type { BankEmailMessage } from "../../domain/finance/email-connection.domain.ts"

// --- Allowlist (remitentes y asuntos EXACTOS o por prefijo) ---

export const BCH_SENDER_DIGITAL = "enviodigital@bancochile.cl"
export const BCH_SENDER_TEF = "serviciodetransferencias@bancochile.cl"

const SUBJECT_CARGO = "cargo en cuenta"
const SUBJECT_COMPRA = "compra con tarjeta de crédito"
const SUBJECT_TRANSFERENCIA = "transferencia a terceros"
const SUBJECT_TRANSFERENCIA_FONDOS_PREFIX = "transferencias de fondos a "
const SUBJECT_ABONOS = [
  "aviso de transferencia de fondos",
  "notificación de abono",
]
// Comprobante de pago de cuota de un crédito de consumo (exacto; tolera tildes).
const SUBJECT_PAGO_CONSUMO = /^comprobante pago cr[eé]dito consumo$/
// Comprobante de pago de tarjeta de crédito, nacional o internacional (asunto exacto; tolera
// tildes). El cuerpo se valida además con SUBJECT_PAGO_TARJETA_BODY.
const SUBJECT_PAGO_TARJETA =
  /^pago de tarjeta de cr[eé]dito (nacional|internacional)$/
const SUBJECT_PAGO_TARJETA_BODY =
  /se ha efectuado el pago de la tarjeta de cr[eé]dito/i

// --- Tipos del evento extraído ---

// Instrumento referido por el correo: cuenta corriente (número completo o últimos 4) o tarjeta de
// crédito (últimos 4). `ref` guarda solo dígitos.
export type EmailInstrumentRef =
  | { kind: "checking"; ref: string }
  | { kind: "credit_card"; last4: string }

export type EmailEventKind = "expense" | "internal_credit" | "internal_payment"

export type EmailEventSource =
  | "cargo_cuenta"
  | "compra_tarjeta"
  | "transferencia"
  | "transferencia_fondos"
  | "abono"
  | "pago_tarjeta"
  | "pago_linea"
  | "pago_credito_consumo"

export type EmailEvent = {
  kind: EmailEventKind
  source: EmailEventSource
  amount: Money
  date: Date // fecha del movimiento (del cuerpo si viene; si no, la de recepción, en UTC; granularidad día)
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
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
}

// --- Extracción de campos (regex acotadas y tolerantes; faltante ⇒ se omite el correo) ---

// CLP: "$ 1.234.567" (puntos de miles). El lookbehind evita confundir "US$".
function parseClp(text: string): Money | null {
  const m = text.match(/(?<![A-Z])\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?!\d)/)
  if (!m) return null
  const pesos = parseInt(m[1].replace(/\./g, ""), 10)
  return Number.isFinite(pesos) && pesos > 0
    ? Money.fromMinor(pesos, "CLP")
    : null
}

// USD: "US$ 12,34" | "USD 1.234,56" | "US$1,234.56" | "USD$142,05". El último separador con 2
// dígitos es decimal.
function parseUsd(text: string): Money | null {
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
function parseAmount(text: string): Money | null {
  return parseUsd(text) ?? parseClp(text)
}

// Últimos 4 de una tarjeta: "terminada en 1234", "**** 1234", "Tarjeta ... 1234".
function parseCardLast4(text: string): string | null {
  const m =
    text.match(/terminad[ao]\s+en\s+[*•Xx\s]*(\d{4})(?!\d)/i) ??
    text.match(/[*•Xx]{2,}\s*(\d{4})(?!\d)/) ??
    text.match(/tarjeta(?:\s+de\s+cr[eé]dito)?[^\d\n]{0,40}(\d{4})(?!\d)/i)
  return m ? m[1] : null
}

// Cuenta corriente: número ("Cuenta N° 00-123-45678-09") o últimos 4 ("cuenta terminada en 1234").
// Devuelve solo dígitos; 4 dígitos ⇒ últimos 4.
function parseAccountRef(text: string): string | null {
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
function parseTefId(text: string): string | null {
  const m = text.match(
    /(?:n[°º]?\s*(?:de\s*)?(?:operaci[oó]n|transacci[oó]n|comprobante)|id\s*(?:tef|de\s*)?(?:operaci[oó]n|transacci[oó]n)?)\s*[:#]?\s*(\d{5,})/i
  )
  return m ? m[1] : null
}

// Comercio de una compra. Cubre la plantilla real "compra por $X con Tarjeta de Crédito
// ****NNNN en COMERCIO el <fecha>" y las variantes "compra por $X en COMERCIO el ..." |
// "en COMERCIO con tu tarjeta".
function parseMerchant(text: string): string | null {
  const m = text.match(
    /compra(?:\s+por\s+(?:US\$|USD|\$)\s*[\d.,]+)?(?:\s+con\s+tarjeta\s+de\s+cr[eé]dito\s+[*•Xx\s]*\d{4})?\s+en\s+(.{2,60}?)(?=\s+el\s+\d|\s+con\s+(?:tu|su)\s+tarjeta|\s*[.,\n]|$)/i
  )
  return m ? cleanupName(m[1]) : null
}

// Motivo de un cargo en cuenta, incluida la plantilla real "... cargo a Cuenta ... en X el ...".
function parseChargeReason(text: string): string | null {
  const m = text.match(
    /(?:con\s+cargo\s+a\s+cuenta\s+[*•Xx\d-]+\s+en|asociado\s+a|por\s+concepto\s+de|correspondiente\s+a)\s+(.{2,60}?)(?=\s+el\s+\d|\s*[.,\n]|$)/i
  )
  return m ? cleanupName(m[1]) : null
}

// Destinatario de una transferencia: "Destinatario: X" | "transferencia ... a X por ...".
function parseRecipient(text: string): string | null {
  const labeled = text.match(
    /destinatario\s*[:.]?\s*(.{2,60}?)(?=\s*[.,\n]|$)/i
  )
  if (labeled) return cleanupName(labeled[1])
  const inline = text.match(
    /transferencia[^\n]{0,80}?\s+a\s+(.{2,60}?)(?=\s+por\s+\$|\s+rut|\s*[.,\n]|$)/i
  )
  return inline ? cleanupName(inline[1]) : null
}

function cleanupName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim()
  return name.length >= 2 ? name : null
}

// Fecha del movimiento en el cuerpo ("dd/mm/yyyy" o "dd-mm-yyyy"); si no viene, la de recepción.
function parseDate(text: string, receivedAt: Date): Date {
  const m = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/)
  if (m) {
    const [, d, mo, y] = m
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)))
    if (!Number.isNaN(date.getTime())) return date
  }
  return new Date(
    Date.UTC(
      receivedAt.getUTCFullYear(),
      receivedAt.getUTCMonth(),
      receivedAt.getUTCDate()
    )
  )
}

// Sección de "Origen" del comprobante de pago (acota de dónde sale la cuenta de cargo, para no
// confundirla con la tarjeta/crédito de destino). Cubre "Datos de Origen … Datos de Destino" (crédito
// de consumo) y "Origen … Destino" (pago de tarjeta). Sin sección, se busca en todo el texto.
function originSection(text: string): string {
  const m = text.match(
    /(?:datos de )?origen([\s\S]*?)(?=(?:datos de )?destino|$)/i
  )
  return m ? m[1] : text
}

// Monto CLP de una etiqueta concreta ("Monto Pagado: $265.708"). Obligatorio en plantillas con
// varias cifras (interés, utilizado, tipo de cambio): el primer "$" del texto NO es el monto pagado.
function parseLabeledClp(text: string, label: RegExp): Money | null {
  const m = text.match(label)
  return m ? parseClp(m[1]) : null
}

// Monto USD de una etiqueta concreta ("Monto pagado USD$142,05"). El grupo 1 incluye el prefijo
// USD$/US$ para que parseUsd lo interprete.
function parseLabeledUsd(text: string, label: RegExp): Money | null {
  const m = text.match(label)
  return m ? parseUsd(m[1]) : null
}

// ID de "Transacción" del comprobante (alfanumérico: BCAMOVIL01…, INTERNET_P…). Identidad estable
// por operación; presente porque el remitente es el de transferencias (parseTefId solo acepta
// dígitos, no sirve para esto).
function parseTransaccionId(text: string): string | null {
  const m = text.match(/transacci[oó]n\s*[:.]?\s*([A-Za-z0-9_]{6,})/i)
  return m ? m[1] : null
}

// Fecha de la etiqueta "Fecha: dd/mm/yyyy" ("Fecha de Vencimiento" no coincide). Sin ella, la del
// cuerpo/recepción.
function parseLabeledDate(text: string, fallback: Date): Date {
  const m = text.match(/\bfecha\s*[:.]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/i)
  return m ? parseDate(m[1], fallback) : fallback
}

// N° de cuota pagada ("N° Cuota: 3").
function parseInstallment(text: string): string | null {
  const m = text.match(/n[°º]?\s*cuota\s*[:.]?\s*(\d{1,3})(?!\d)/i)
  return m ? m[1] : null
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

// --- Parser principal ---

function normalizeSubject(subject: string): string {
  return subject.replace(/\s+/g, " ").trim().toLowerCase()
}

export function parseBancoChileEmail(msg: BankEmailMessage): ParsedEmail {
  const from = msg.from.trim().toLowerCase()
  if (from !== BCH_SENDER_DIGITAL && from !== BCH_SENDER_TEF)
    return { ok: false, reason: "remitente_desconocido" }

  const subject = normalizeSubject(msg.subject)
  const text = htmlToText(msg.htmlBody)
  const base = {
    date: parseDate(text, msg.receivedAt),
    tefId: null as string | null,
  }

  if (from === BCH_SENDER_DIGITAL) {
    if (subject === SUBJECT_CARGO) {
      const amount = parseClp(text)
      if (!amount) return { ok: false, reason: "sin_monto" }
      const ref = parseAccountRef(text)
      if (!ref) return { ok: false, reason: "sin_instrumento" }
      return event({
        ...base,
        kind: "expense",
        source: "cargo_cuenta",
        amount,
        description: parseChargeReason(text) ?? "Cargo en cuenta",
        instrument: { kind: "checking", ref },
        paymentTarget: null,
        msg,
      })
    }
    if (subject === SUBJECT_COMPRA) {
      const amount = parseAmount(text)
      if (!amount) return { ok: false, reason: "sin_monto" }
      const last4 = parseCardLast4(text)
      if (!last4) return { ok: false, reason: "sin_instrumento" }
      return event({
        ...base,
        kind: "expense",
        source: "compra_tarjeta",
        amount,
        description: parseMerchant(text) ?? "Compra con tarjeta de crédito",
        instrument: { kind: "credit_card", last4 },
        paymentTarget: null,
        msg,
      })
    }
    // Comprobantes de pago de tarjeta/línea: SOLO evento interno de balance (no gasto/ingreso).
    if (/\bpago\b/.test(subject) && /tarjeta de cr[eé]dito/.test(subject)) {
      const amount = parseAmount(text)
      if (!amount) return { ok: false, reason: "sin_monto" }
      const last4 = parseCardLast4(text)
      return event({
        ...base,
        kind: "internal_payment",
        source: "pago_tarjeta",
        amount,
        description: "Pago de tarjeta de crédito",
        instrument: last4 ? { kind: "credit_card", last4 } : null,
        paymentTarget:
          amount.currency === "USD"
            ? "credit_international"
            : "credit_national",
        msg,
      })
    }
    if (/\bpago\b/.test(subject) && /l[ií]nea de cr[eé]dito/.test(subject)) {
      const amount = parseClp(text)
      if (!amount) return { ok: false, reason: "sin_monto" }
      const ref = parseAccountRef(text)
      return event({
        ...base,
        kind: "internal_payment",
        source: "pago_linea",
        amount,
        description: "Pago de línea de crédito",
        instrument: ref ? { kind: "checking", ref } : null,
        paymentTarget: "overdraft",
        msg,
      })
    }
    if (SUBJECT_ABONOS.includes(subject)) {
      return parseAbono(text, base.date, msg)
    }
    return { ok: false, reason: "asunto_desconocido" }
  }

  // from === BCH_SENDER_TEF
  if (
    subject === SUBJECT_TRANSFERENCIA ||
    subject.startsWith(SUBJECT_TRANSFERENCIA_FONDOS_PREFIX)
  ) {
    const amount = parseClp(text)
    if (!amount) return { ok: false, reason: "sin_monto" }
    const ref = parseAccountRef(text)
    if (!ref) return { ok: false, reason: "sin_instrumento" }
    const tefId = parseTefId(text)
    const isFondos = subject.startsWith(SUBJECT_TRANSFERENCIA_FONDOS_PREFIX)
    // "Transferencias de Fondos a <comercio>": el comercio viene en el asunto (fuente más estable).
    const subjectMerchant = isFondos
      ? cleanupName(
          msg.subject.trim().slice(SUBJECT_TRANSFERENCIA_FONDOS_PREFIX.length)
        )
      : null
    const recipient = subjectMerchant ?? parseRecipient(text)
    return event({
      date: base.date,
      tefId,
      kind: "expense",
      source: isFondos ? "transferencia_fondos" : "transferencia",
      amount,
      description: recipient
        ? `Transferencia a ${recipient}`
        : "Transferencia a terceros",
      instrument: { kind: "checking", ref },
      paymentTarget: null,
      msg,
    })
  }
  if (SUBJECT_ABONOS.includes(subject)) {
    return parseAbono(text, base.date, msg)
  }
  // Pago de tarjeta de crédito (nacional/internacional): movimiento INTERNO de dos patas. La pata de
  // deuda baja el Utilizado de la tarjeta (libera cupo); la pata de caja (cashLeg) baja la cuenta
  // corriente de origen. Nada de esto es gasto/ingreso/presupuesto. El monto sale de la etiqueta
  // "Monto"/"Monto pagado", NUNCA de "Utilizado". El use-case expande cashLeg a un segundo movimiento.
  const pagoTarjeta = subject.match(SUBJECT_PAGO_TARJETA)
  if (pagoTarjeta) {
    if (!SUBJECT_PAGO_TARJETA_BODY.test(text))
      return { ok: false, reason: "plantilla_desconocida" }
    const internacional = pagoTarjeta[1] === "internacional"
    // Deuda en la moneda de la tarjeta: USD ("Monto pagado") o CLP ("Monto"). "Utilizado" es la
    // deuda previa, no el pago.
    const debtAmount = internacional
      ? parseLabeledUsd(
          text,
          /monto\s+pagado\s*[:.]?\s*((?:US\$|USD\$?)\s*[\d.,]+)/i
        )
      : parseLabeledClp(text, /\bmonto\s*[:.]?\s*(\$\s*[\d.]+)/i)
    if (!debtAmount) return { ok: false, reason: "sin_monto" }
    // Caja: CLP cargado a la cuenta corriente. Nacional = mismo monto; internacional = etiqueta
    // "Monto" en CLP. El requisito de "$" inmediato tras "Monto" evita capturar "Monto pagado" (USD).
    const cashAmount = internacional
      ? parseLabeledClp(text, /\bmonto\s*[:.]?\s*(\$\s*[\d.]+)/i)
      : debtAmount
    if (!cashAmount) return { ok: false, reason: "sin_monto" }
    const last4 = parseCardLast4(text)
    if (!last4) return { ok: false, reason: "sin_instrumento" }
    const ref = parseAccountRef(originSection(text))
    if (!ref) return { ok: false, reason: "sin_instrumento" }
    return event({
      date: base.date,
      txnId: parseTransaccionId(text),
      tefId: null,
      kind: "internal_payment",
      source: "pago_tarjeta",
      amount: debtAmount,
      description: `Pago Tarjeta de Crédito ••••${last4}`,
      instrument: { kind: "credit_card", last4 },
      paymentTarget: internacional ? "credit_international" : "credit_national",
      cashLeg: { ref, amount: cashAmount },
      msg,
    })
  }
  // Pago de cuota de crédito de consumo: GASTO real de la cuenta de origen, no un pago interno. A
  // diferencia de la tarjeta (cuya compra ya se registró el día que ocurrió), el consumo financiado
  // por el crédito nunca entró a la app: la cuota es la única vez que ese dinero aparece, y además
  // incluye intereses. El N° de crédito no se extrae ni se guarda.
  // ponytail: la cuota completa es un gasto categorizable; separar interés/amortización solo si se
  // modela la deuda del crédito (decisión de dominio del issue WDC-11).
  if (SUBJECT_PAGO_CONSUMO.test(subject)) {
    const amount = parseLabeledClp(
      text,
      /monto\s+pagado\s*[:.]?\s*(\$\s*[\d.]+)/i
    )
    if (!amount) return { ok: false, reason: "sin_monto" }
    const ref = parseAccountRef(originSection(text))
    if (!ref) return { ok: false, reason: "sin_instrumento" }
    const cuota = parseInstallment(text)
    return event({
      date: parseLabeledDate(text, base.date),
      tefId: parseTefId(text),
      kind: "expense",
      source: "pago_credito_consumo",
      amount,
      description: cuota
        ? `Pago cuota ${cuota} de crédito de consumo`
        : "Pago de cuota de crédito de consumo",
      instrument: { kind: "checking", ref },
      paymentTarget: null,
      msg,
    })
  }
  return { ok: false, reason: "asunto_desconocido" }
}

// Abono recibido: SOLO movimiento interno de balance (no ingreso/presupuesto). Exige monto y
// cuenta destino inequívoca; si falta la cuenta, se omite (nunca se adivina).
function parseAbono(
  text: string,
  date: Date,
  msg: BankEmailMessage
): ParsedEmail {
  const amount = parseClp(text)
  if (!amount) return { ok: false, reason: "sin_monto" }
  const ref = parseAccountRef(text)
  if (!ref) return { ok: false, reason: "sin_instrumento" }
  return event({
    date,
    tefId: parseTefId(text),
    kind: "internal_credit",
    source: "abono",
    amount,
    description: "Abono recibido",
    instrument: { kind: "checking", ref },
    paymentTarget: null,
    msg,
  })
}

function event(input: {
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
