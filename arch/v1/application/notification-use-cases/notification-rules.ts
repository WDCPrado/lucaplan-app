// Reglas PURAS de qué se notifica y con qué texto. Sin IO: reciben datos ya cargados y devuelven
// el PushMessage o `null` (= no molestar). Todo lo decidible sin base de datos vive aquí, para que
// se pueda testear con `node --test`.
import {
  CURRENCY_DECIMALS,
  type CurrencyCode,
} from "../../domain/finance/money.ts"
import type { PushMessage } from "../../domain/notifications/push.domain.ts"

// ponytail: formato propio de 3 líneas en vez de importar lib/finance-format (es UI, alias @/, y
// los use-cases deben correr en node --test sin resolver alias).
const SYMBOL: Record<CurrencyCode, string> = { CLP: "$", USD: "US$" }

function money(value: number, currency: CurrencyCode): string {
  const digits = CURRENCY_DECIMALS[currency]
  return `${SYMBOL[currency]}${new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(value))}`
}

export type NotifiableMovement = {
  description: string
  amount: number
  currency: CurrencyCode
  direction: "debit" | "credit"
}

/**
 * Movimientos recién importados desde el correo del banco. Uno solo se nombra; varios se resumen
 * (no se dispara una notificación por cada compra de una tanda). Lista vacía → `null`.
 */
export function newMovementsMessage(
  movements: NotifiableMovement[]
): PushMessage | null {
  if (movements.length === 0) return null
  if (movements.length === 1) {
    const m = movements[0]
    const charge = m.direction === "debit"
    return {
      title: charge ? "Nuevo gasto" : "Nuevo abono",
      body: `${money(m.amount, m.currency)} · ${m.description}`,
      url: "/dashboard",
      tag: "movements",
    }
  }
  // Resumen: se suma solo la moneda del primero para no inventar conversiones (USD≠CLP).
  const currency = movements[0].currency
  const total = movements
    .filter((m) => m.currency === currency && m.direction === "debit")
    .reduce((sum, m) => sum + m.amount, 0)
  return {
    title: `${movements.length} movimientos nuevos`,
    body:
      total > 0
        ? `${money(total, currency)} en gastos`
        : "Revisa tus movimientos del mes.",
    url: "/dashboard",
    tag: "movements",
  }
}

// Umbrales de aviso del presupuesto, de mayor a menor: solo se avisa el más alto que se CRUZA.
const THRESHOLDS = [1, 0.8] as const

/**
 * Alerta de presupuesto del mes. Se dispara SOLO cuando el gasto cruza un umbral con este
 * movimiento (antes por debajo, después en o sobre él): así no hace falta guardar "ya avisé" —
 * el cruce ocurre una vez. Sin límite definido (o límite 0) no hay nada que alertar.
 */
export function budgetAlertMessage(
  usedBefore: number,
  usedAfter: number,
  limit: number,
  currency: CurrencyCode = "CLP"
): PushMessage | null {
  if (limit <= 0) return null
  const crossed = THRESHOLDS.find(
    (t) => usedBefore < limit * t && usedAfter >= limit * t
  )
  if (crossed === undefined) return null
  return {
    title:
      crossed === 1
        ? "Superaste tu presupuesto"
        : "Vas en el 80% del presupuesto",
    body: `Llevas ${money(usedAfter, currency)} de ${money(limit, currency)} este mes.`,
    url: "/dashboard",
    tag: "budget",
  }
}

export type DueItem = {
  description: string
  amount: number
  currency: CurrencyCode
  dueDate: Date
}

// Días de diferencia en UTC (las fechas del proyecto se guardan y comparan en UTC).
const DAY_MS = 86_400_000
function daysUntil(dueDate: Date, now: Date): number {
  const utc = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return Math.round((utc(dueDate) - utc(now)) / DAY_MS)
}

/**
 * Recordatorio de pagos por vencer (recurrentes y cuotas) dentro de la ventana. Uno se nombra con
 * su vencimiento; varios se resumen. Nada en ventana → `null` (no se notifica "no tienes pagos").
 */
export function dueSoonMessage(
  items: DueItem[],
  now: Date,
  windowDays = 2
): PushMessage | null {
  const due = items.filter((i) => {
    const d = daysUntil(i.dueDate, now)
    return d >= 0 && d <= windowDays
  })
  if (due.length === 0) return null
  if (due.length === 1) {
    const i = due[0]
    const d = daysUntil(i.dueDate, now)
    const when = d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`
    return {
      title: `Vence ${when}: ${i.description}`,
      body: money(i.amount, i.currency),
      url: "/recurring",
      tag: "due",
    }
  }
  const currency = due[0].currency
  const total = due
    .filter((i) => i.currency === currency)
    .reduce((sum, i) => sum + i.amount, 0)
  return {
    title: `${due.length} pagos por vencer`,
    body: `${money(total, currency)} en los próximos ${windowDays} días.`,
    url: "/recurring",
    tag: "due",
  }
}
