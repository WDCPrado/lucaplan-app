// Parser PURO de notificaciones de correo de Banco de Chile → evento financiero de dominio.
// Fail-closed: solo remitentes y asuntos de la allowlist producen eventos; cualquier otro correo, o
// una plantilla permitida a la que le falte un dato obligatorio (monto/instrumento), se OMITE con
// un motivo sin contenido sensible. El cuerpo HTML se procesa solo en memoria: aquí no se persiste
// ni se registra nada del correo. Los tipos y los helpers comunes a todo banco viven en
// bank-email-map.ts; aquí queda solo lo específico de estas plantillas.
import type { BankEmailMessage } from "../../domain/finance/email-connection.domain.ts"
import {
  cleanupName,
  emailEvent,
  htmlToText,
  normalizeSubject,
  originSection,
  parseAccountRef,
  parseAmount,
  parseCardLast4,
  parseClp,
  parseDate,
  parseLabeledClp,
  parseLabeledUsd,
  parseTefId,
  type ParsedEmail,
} from "./bank-email-map.ts"

// --- Allowlist (remitentes y asuntos EXACTOS o por prefijo) ---

export const BCH_SENDER_DIGITAL = "enviodigital@bancochile.cl"
export const BCH_SENDER_TEF = "serviciodetransferencias@bancochile.cl"

const SUBJECT_CARGO = "cargo en cuenta"
const SUBJECT_COMPRA = "compra con tarjeta de crédito"
const SUBJECT_TRANSFERENCIA = "transferencia a terceros"
const SUBJECT_TRANSFERENCIA_FONDOS_PREFIX = "transferencias de fondos a "
// Abonos recibidos: se RECONOCEN para descartarlos con un motivo propio, no se procesan. El correo
// de una transferencia recibida es idéntico venga de tu sueldo o de un amigo devolviéndote plata —
// mismo remitente, misma plantilla— y crear el movimiento obligaría a decidir cuál es sin datos.
// La plata que entra se declara en el módulo de Ingresos, que sí sabe cuál es cuál.
const SUBJECT_ABONOS = [
  "aviso de transferencia de fondos",
  "notificación de abono",
]
// Comprobante de pago de cuota de un crédito de consumo (exacto; tolera tildes).
const SUBJECT_PAGO_CONSUMO = /^comprobante pago cr[eé]dito consumo$/
// Comprobante de pago de tarjeta de crédito, nacional o internacional. Dos plantillas conviven:
// la antigua ("Pago de Tarjeta de Crédito Nacional") y la vigente desde 2026 ("Comprobante Pago
// Tarjeta"), cuyo asunto ya no nombra "de crédito" y omite "nacional" en el caso nacional. El
// cuerpo se valida además con SUBJECT_PAGO_TARJETA_BODY.
const SUBJECT_PAGO_TARJETA =
  /^(?:pago de tarjeta de cr[eé]dito (nacional|internacional)|comprobante pago tarjeta(?:\s+(internacional))?)$/
const SUBJECT_PAGO_TARJETA_BODY =
  /se\s+ha\s+(?:efectuado\s+el\s+pago\s+de|realizado\s+un\s+pago\s+a)\s+la\s+tarjeta\s+de\s+cr[eé]dito/i
// La plantilla vigente no trae la tabla Origen/Destino: el detalle va en un párrafo y las cifras
// se etiquetan "Monto Pagado" (deuda) y "Monto Pagado Pesos" (caja, solo en la internacional).
const PAGO_TARJETA_V2 =
  /se\s+ha\s+realizado\s+un\s+pago\s+a\s+la\s+tarjeta\s+de\s+cr[eé]dito/i

// --- Extracción específica de estas plantillas ---

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

// --- Parser principal ---

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
      return emailEvent({
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
      return emailEvent({
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
      return emailEvent({
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
      return emailEvent({
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
    if (SUBJECT_ABONOS.includes(subject))
      return { ok: false, reason: "abono_ignorado" }
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
    return emailEvent({
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
  if (SUBJECT_ABONOS.includes(subject))
    return { ok: false, reason: "abono_ignorado" }
  // Pago de tarjeta de crédito (nacional/internacional): movimiento INTERNO de dos patas. La pata de
  // deuda baja el Utilizado de la tarjeta (libera cupo); la pata de caja (cashLeg) baja la cuenta
  // corriente de origen. Nada de esto es gasto/ingreso/presupuesto. El monto sale de la etiqueta
  // "Monto"/"Monto pagado", NUNCA de "Utilizado". El use-case expande cashLeg a un segundo movimiento.
  const pagoTarjeta = subject.match(SUBJECT_PAGO_TARJETA)
  if (pagoTarjeta) {
    if (!SUBJECT_PAGO_TARJETA_BODY.test(text))
      return { ok: false, reason: "plantilla_desconocida" }
    // El sufijo "internacional" viene del asunto en cualquiera de sus dos formas; su ausencia
    // significa nacional, que es como la plantilla vigente titula el caso en pesos.
    const internacional =
      (pagoTarjeta[1] ?? pagoTarjeta[2]) === "internacional"
    const v2 = PAGO_TARJETA_V2.test(text)
    // Deuda en la moneda de la tarjeta: USD ("Monto pagado") o CLP ("Monto" en la plantilla
    // antigua, "Monto Pagado" en la vigente). "Utilizado" es la deuda previa, no el pago.
    const debtAmount = internacional
      ? parseLabeledUsd(
          text,
          /monto\s+pagado\s*[:.]?\s*((?:US\$|USD\$?)\s*[\d.,]+)/i
        )
      : parseLabeledClp(
          text,
          v2
            ? /monto\s+pagado\s*[:.]?\s*(\$\s*[\d.]+)/i
            : /\bmonto\s*[:.]?\s*(\$\s*[\d.]+)/i
        )
    if (!debtAmount) return { ok: false, reason: "sin_monto" }
    // Caja: CLP cargado a la cuenta corriente. Nacional = mismo monto; internacional = su propia
    // etiqueta en pesos. El requisito de "$" inmediato evita capturar el importe en USD, y en la
    // plantilla vigente hay que exigir "Pesos" porque "Monto Pagado" a secas es el de USD.
    const cashAmount = internacional
      ? parseLabeledClp(
          text,
          v2
            ? /monto\s+pagado\s+pesos\s*[:.]?\s*(\$\s*[\d.]+)/i
            : /\bmonto\s*[:.]?\s*(\$\s*[\d.]+)/i
        )
      : debtAmount
    if (!cashAmount) return { ok: false, reason: "sin_monto" }
    const last4 = parseCardLast4(text)
    if (!last4) return { ok: false, reason: "sin_instrumento" }
    // La plantilla vigente no tiene sección "Origen": la cuenta de cargo va en el párrafo, así que
    // acotar la búsqueda ahí la perdería.
    const ref = parseAccountRef(v2 ? text : originSection(text))
    if (!ref) return { ok: false, reason: "sin_instrumento" }
    return emailEvent({
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
    return emailEvent({
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
