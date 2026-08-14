// Parser PURO de notificaciones de correo de Banco BICE → evento financiero de dominio.
// Mismo contrato que el resto de bancos (docs/bank-email-contract.md): fail-closed, sin persistir
// nada del correo, y del correo nunca sale una entrada de dinero.
//
// Las plantillas de BICE son tablas de "etiqueta | valor" (Monto, Número de cuenta, Cupo, Medio de
// pago, Número de operación). El monto SIEMPRE sale de su etiqueta: la letra chica de las
// promociones trae cifras en pesos ("Costo Total del Crédito de $300.594") que un `$` suelto
// confundiría con el movimiento.
import type { BankEmailMessage } from "../../domain/finance/email-connection.domain.ts"
import {
  cleanupName,
  dayOf,
  emailEvent,
  htmlToText,
  labeled,
  normalizeSubject,
  originSection,
  parseAccountRef,
  parseCardLast4,
  parseClp,
  parseUsd,
  type ParsedEmail,
} from "./bank-email-map.ts"

// --- Allowlist ---

// Único remitente que notifica movimientos. Los demás (beneficiosbice@, newsletter-bicestore@,
// experiencia@, servicioalcliente@…) son marketing o servicio y no entran al catálogo: el enrutado
// por remitente los descarta antes de llegar aquí.
export const BICE_SENDER = "reply@info.bice.cl"

const SUBJECT_TRANSFERENCIA = "hicimos la transferencia"
const SUBJECT_PAGO_COMERCIO_PREFIX = "enviamos tu pago a "
// Mismo asunto para el pago nacional y el internacional: los distingue la etiqueta "Cupo".
const SUBJECT_PAGO_TARJETA =
  /^confirmaci[oó]n del pago de tarjeta de cr[eé]dito$/
// Plata que entra: se reconoce para descartarla con motivo propio. Ver la regla universal del
// contrato — un correo bancario nunca crea una entrada de dinero.
const SUBJECT_ABONOS = [
  "recibiste una transferencia",
  "aviso de transferencia de fondos",
]

// --- Extracción de estas plantillas ---

// Número de operación: alfanumérico ("EXP0067420260790738557") o solo dígitos ("239167263").
function parseOperacionId(text: string): string | null {
  const m = text.match(/n[uú]mero de operaci[oó]n[\s:|*-]*([A-Za-z0-9]{5,})/i)
  return m ? m[1] : null
}

const MESES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
]

// Fecha del movimiento al pie de la plantilla: "28 Jul 2026, 17:12" | "03 ago 2026 - 09:15 h".
// Sin ella, la de recepción. La letra chica escribe los meses completos y con "de" ("31 de agosto
// de 2026"), que este patrón no acepta: pide día, mes abreviado y año seguidos.
function parseBiceDate(text: string, receivedAt: Date): Date {
  const m = text.match(
    /\b(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\.?\s+(\d{4})\b/i
  )
  if (!m) return dayOf(receivedAt)
  const month = MESES.indexOf(m[2].toLowerCase())
  const date = new Date(Date.UTC(Number(m[3]), month, Number(m[1])))
  return Number.isNaN(date.getTime()) ? dayOf(receivedAt) : date
}

// Destinatario de una transferencia enviada: el "Nombre" de la sección de destino. Se acota a esa
// sección porque el saludo del cuerpo trae el nombre del propio titular. RUT, correo y número de
// cuenta del destinatario NO se extraen.
function parseDestinatario(text: string): string | null {
  const i = text.search(/cuenta de destino/i)
  if (i === -1) return null
  const name = labeled(text.slice(i), "nombre")
  return name ? cleanupName(name) : null
}

// Cuenta de cargo del pago de tarjeta: "Medio de pago | Cuenta corriente N° 78497402". Esta
// plantilla no tiene sección de origen, así que no sirve parseAccountRef sobre originSection.
function parseMedioDePago(text: string): string | null {
  const m = text.match(/medio de pago[\s:|*-]*cuenta[^\d]{0,20}(\d{5,})/i)
  return m ? m[1] : null
}

// --- Parser principal ---

export function parseBiceEmail(msg: BankEmailMessage): ParsedEmail {
  if (msg.from.trim().toLowerCase() !== BICE_SENDER)
    return { ok: false, reason: "remitente_desconocido" }

  const subject = normalizeSubject(msg.subject)
  const text = htmlToText(msg.htmlBody)
  const date = parseBiceDate(text, msg.receivedAt)

  // Transferencia enviada a un tercero: gasto de la cuenta corriente de origen.
  if (subject === SUBJECT_TRANSFERENCIA) {
    const amount = parseClp(labeled(text, "monto") ?? "")
    if (!amount) return { ok: false, reason: "sin_monto" }
    const ref = parseAccountRef(originSection(text))
    if (!ref) return { ok: false, reason: "sin_instrumento" }
    const destinatario = parseDestinatario(text)
    return emailEvent({
      date,
      txnId: parseOperacionId(text),
      tefId: null,
      kind: "expense",
      source: "transferencia",
      amount,
      description: destinatario
        ? `Transferencia a ${destinatario}`
        : "Transferencia a terceros",
      instrument: { kind: "checking", ref },
      paymentTarget: null,
      msg,
    })
  }

  // "Enviamos tu pago a <comercio>": pago de servicios desde la cuenta corriente. El comercio sale
  // del asunto, que es más estable que el cuerpo.
  if (subject.startsWith(SUBJECT_PAGO_COMERCIO_PREFIX)) {
    const amount = parseClp(labeled(text, "monto") ?? "")
    if (!amount) return { ok: false, reason: "sin_monto" }
    const ref = parseAccountRef(originSection(text))
    if (!ref) return { ok: false, reason: "sin_instrumento" }
    const comercio = cleanupName(
      msg.subject.trim().slice(SUBJECT_PAGO_COMERCIO_PREFIX.length)
    )
    return emailEvent({
      date,
      txnId: parseOperacionId(text),
      tefId: null,
      kind: "expense",
      source: "transferencia_fondos",
      amount,
      description: comercio ? `Pago a ${comercio}` : "Pago a un comercio",
      instrument: { kind: "checking", ref },
      paymentTarget: null,
      msg,
    })
  }

  // Pago de tarjeta de crédito: movimiento INTERNO de dos patas (baja el utilizado de la tarjeta y
  // descuenta de la cuenta corriente). Ni gasto ni ingreso. El cupo decide la moneda de la deuda:
  // nacional cobra en pesos; internacional informa la deuda en dólares ("Monto") y lo cargado en
  // pesos ("Monto pagado", con su tipo de cambio).
  if (SUBJECT_PAGO_TARJETA.test(subject)) {
    const cupo = labeled(text, "cupo")?.toLowerCase()
    if (cupo !== "nacional" && cupo !== "internacional")
      return { ok: false, reason: "plantilla_desconocida" }
    const internacional = cupo === "internacional"
    const monto = labeled(text, "monto") ?? ""
    const debtAmount = internacional ? parseUsd(monto) : parseClp(monto)
    if (!debtAmount) return { ok: false, reason: "sin_monto" }
    const cashAmount = internacional
      ? parseClp(labeled(text, "monto pagado") ?? "")
      : debtAmount
    if (!cashAmount) return { ok: false, reason: "sin_monto" }
    const last4 = parseCardLast4(text)
    if (!last4) return { ok: false, reason: "sin_instrumento" }
    const ref = parseMedioDePago(text)
    if (!ref) return { ok: false, reason: "sin_instrumento" }
    return emailEvent({
      date,
      txnId: parseOperacionId(text),
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

  if (SUBJECT_ABONOS.includes(subject))
    return { ok: false, reason: "abono_ignorado" }
  // ponytail: faltan los cargos en cuenta y las compras con tarjeta (crédito y débito) — no
  // aparecieron ejemplos en la revisión de tres meses del buzón. Hasta tenerlos se omiten como
  // asunto no catalogado, que es el comportamiento correcto: inventar la plantilla sería peor.
  return { ok: false, reason: "asunto_desconocido" }
}
