// Detección PURA de candidatos de instrumentos a partir de los eventos parseados del mes.
// No persiste nada: el resultado se muestra al usuario para corregir/agregar/validar ANTES de crear
// banco, cuentas, tarjetas, buckets o movimientos. Cargos CLP y USD con el mismo último 4 de
// tarjeta de crédito se agrupan en UNA tarjeta con dos monedas (dos buckets), nunca en dos.
import type { CurrencyCode } from "../../domain/finance/money.ts"
import type { EmailSkipReason, ParsedEmail } from "./bank-email-map.ts"

export type CheckingCandidate = {
  kind: "checking"
  ref: string // número de cuenta (solo dígitos) o últimos 4 si el correo no trae el número
  last4: string // últimos 4 del ref (para mostrar)
  movementCount: number
}

export type CardCandidate = {
  kind: "credit_card"
  last4: string
  currencies: CurrencyCode[] // ["CLP"], ["USD"] o ambas — monedas detectadas en el mes
  movementCount: number
}

export type InstrumentCandidate = CheckingCandidate | CardCandidate

export type EmailScanSummary = {
  candidates: InstrumentCandidate[]
  totalMessages: number
  expenseCount: number
  internalCount: number
  // Movimientos que el correo refiere solo como "tu cuenta principal", sin número. No producen
  // candidato —no hay dígitos que proponer— pero sí se importan si el usuario confirma UNA cuenta
  // corriente. Se cuentan aparte para poder explicarle por qué la revisión llega vacía y qué se
  // pierde si no agrega esa cuenta.
  primaryCheckingCount: number
  skippedCount: number
  skippedReasons: Partial<Record<EmailSkipReason, number>>
}

export function detectCandidates(parsed: ParsedEmail[]): EmailScanSummary {
  const checkingCounts = new Map<string, number>() // ref (dígitos) → conteo
  const cardCounts = new Map<
    string,
    { currencies: Set<CurrencyCode>; count: number }
  >()
  let expenseCount = 0
  let internalCount = 0
  let primaryCheckingCount = 0
  let skippedCount = 0
  const skippedReasons: Partial<Record<EmailSkipReason, number>> = {}

  for (const p of parsed) {
    if (!p.ok) {
      skippedCount++
      skippedReasons[p.reason] = (skippedReasons[p.reason] ?? 0) + 1
      continue
    }
    const e = p.event
    if (e.kind === "expense") expenseCount++
    else internalCount++
    if (!e.instrument) continue
    // "Cuenta principal" no numera nada: no hay candidato que proponer. La cuenta sale de los
    // correos que sí identifican el instrumento, o la agrega el usuario en la confirmación.
    if (e.instrument.kind === "primary_checking") {
      primaryCheckingCount++
      continue
    }
    if (e.instrument.kind === "checking") {
      checkingCounts.set(
        e.instrument.ref,
        (checkingCounts.get(e.instrument.ref) ?? 0) + 1
      )
    } else {
      const entry = cardCounts.get(e.instrument.last4) ?? {
        currencies: new Set<CurrencyCode>(),
        count: 0,
      }
      entry.currencies.add(e.amount.currency)
      entry.count++
      cardCounts.set(e.instrument.last4, entry)
    }
  }

  // Cuentas corrientes: los refs de solo 4 dígitos se funden con el número completo que termina en
  // ellos, si es único. Con cero o varios números posibles quedan como candidato propio (el usuario
  // resuelve la ambigüedad en la revisión; nunca se adivina).
  const fullRefs = [...checkingCounts.keys()].filter((r) => r.length > 4)
  const checking = new Map<string, number>()
  for (const [ref, count] of checkingCounts) {
    if (ref.length === 4) {
      const matches = fullRefs.filter((f) => f.endsWith(ref))
      const target = matches.length === 1 ? matches[0] : ref
      checking.set(target, (checking.get(target) ?? 0) + count)
    } else {
      checking.set(ref, (checking.get(ref) ?? 0) + count)
    }
  }

  const candidates: InstrumentCandidate[] = [
    ...[...checking.entries()].map(
      ([ref, movementCount]): CheckingCandidate => ({
        kind: "checking",
        ref,
        last4: ref.slice(-4),
        movementCount,
      })
    ),
    ...[...cardCounts.entries()].map(
      ([last4, { currencies, count }]): CardCandidate => ({
        kind: "credit_card",
        last4,
        currencies: [...currencies].sort(), // CLP antes que USD (orden estable para la UI)
        movementCount: count,
      })
    ),
  ]

  return {
    candidates,
    totalMessages: parsed.length,
    expenseCount,
    internalCount,
    primaryCheckingCount,
    skippedCount,
    skippedReasons,
  }
}
