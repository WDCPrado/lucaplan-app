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
  // Id del movimiento ya persistido: el aviso enlaza a `/dashboard?tx=<id>` y la app abre su modal.
  // Ausente = el aviso lleva al dashboard sin abrir nada.
  id?: string
  // Id del banco: sirve para reconocer el lote entre los movimientos ya persistidos (y ver cuáles
  // quedaron categorizados). Ausente = no se puede reconocer; solo afecta la alerta de presupuesto.
  externalId?: string | null
  // Nombre de la categoría que quedó asignada (la IA corre antes de notificar). Ausente/null = el
  // movimiento quedó sin clasificar: el aviso lo omite en vez de inventar.
  category?: string | null
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
      // La categoría cierra la pregunta obvia ("¿dónde quedó clasificado?"); sin ella, el aviso
      // queda igual que antes en vez de mostrar un separador huérfano.
      body: `${money(m.amount, m.currency)} · ${m.description}${m.category ? ` · ${m.category}` : ""}`,
      // Tocar el aviso abre el movimiento, no una lista donde haya que buscarlo.
      url: m.id ? `/dashboard?tx=${m.id}` : "/dashboard",
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

/**
 * Alerta del presupuesto de UNA categoría en el mes. Los umbrales configurados valen para todas:
 * cada categoría los mide contra SU propio límite. Se dispara SOLO cuando el gasto de la categoría
 * cruza un umbral (antes por debajo, después en o sobre él): así no hace falta guardar "ya avisé",
 * el cruce ocurre una vez. Sin límite (o límite 0) no hay nada que alertar.
 *
 * Se avisa UNO solo: el umbral MÁS ALTO que se cruza (del 40% al 90% con umbrales 50 y 80 → avisa
 * una vez, no dos). El umbral es el GATILLO; lo que el aviso reporta es el % REAL alcanzado: saltar
 * de 40% a 139% con umbral 80 dice 139%, no 80 — decir el umbral sería mentir sobre el gasto.
 */
export function budgetAlertMessage(
  category: { id: string; name: string },
  usedBefore: number,
  usedAfter: number,
  limit: number,
  percents: number[],
  currency: CurrencyCode = "CLP"
): PushMessage | null {
  if (limit <= 0) return null
  const crossed = [...percents]
    .sort((a, b) => b - a)
    .find((p) => usedBefore < limit * (p / 100) && usedAfter >= limit * (p / 100))
  if (crossed === undefined) return null
  const real = Math.round((usedAfter / limit) * 100)
  return {
    title:
      real > 100
        ? `${category.name}: te pasaste, vas en el ${real}%`
        : real === 100
          ? `${category.name}: presupuesto completo`
          : `${category.name}: vas en el ${real}% del presupuesto`,
    body: `Llevas ${money(usedAfter, currency)} de ${money(limit, currency)} este mes.`,
    url: "/dashboard",
    // Una notificación viva por categoría: dos categorías distintas no se pisan entre sí.
    tag: `budget:${category.id}`,
  }
}

export type DueItem = {
  description: string
  amount: number
  currency: CurrencyCode
  dueDate: Date
  kind: "installment" | "recurring" // de dónde viene: decide a qué página lleva el aviso
}

// Página que abre el aviso: la de cuotas si todo lo que vence son cuotas; si hay alguna recurrente
// (o están mezcladas), la de recurrentes.
function dueUrl(items: DueItem[]): string {
  return items.every((i) => i.kind === "installment")
    ? "/installments"
    : "/recurring"
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
      url: dueUrl(due),
      tag: "due",
    }
  }
  const currency = due[0].currency
  const total = due
    .filter((i) => i.currency === currency)
    .reduce((sum, i) => sum + i.amount, 0)
  return {
    title: `${due.length} pagos por vencer`,
    body:
      windowDays === 0
        ? `${money(total, currency)} vencen hoy.`
        : `${money(total, currency)} en los próximos ${windowDays} día${windowDays === 1 ? "" : "s"}.`,
    url: dueUrl(due),
    tag: "due",
  }
}
