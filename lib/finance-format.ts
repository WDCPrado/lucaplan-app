// Formato de montos y periodos para la UI financiera.
// Relativo con .ts (no `@/`) a propósito: así este módulo corre con `node --test`, que no resuelve
// el alias. Misma regla que usan los use-cases en arch/.
import {
  CURRENCY_DECIMALS,
  type CurrencyCode,
} from "../arch/v1/domain/finance/money.ts"

const groupFmt = (currency: CurrencyCode) =>
  new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: CURRENCY_DECIMALS[currency],
    maximumFractionDigits: CURRENCY_DECIMALS[currency],
  })

/** Número agrupado según la moneda, SIN símbolo (para inputs). Ej. CLP 12965→"12.965", USD 19.1→"19,10". */
export function groupByCurrency(value: number, currency: CurrencyCode): string {
  return groupFmt(currency).format(value)
}

// Símbolo por moneda: en Chile "$" es el peso, así que el dólar SIEMPRE va como "US$" — si no,
// un monto USD se lee como CLP (mismo símbolo, solo cambian los decimales).
const SYMBOL: Record<CurrencyCode, string> = { CLP: "$", USD: "US$" }

/** Monto con símbolo, decimales por moneda y signo. Ej. "$12.965", "US$19,10". Fuente única de formato. */
export function formatMoney(value: number, currency: CurrencyCode): string {
  const sign = value < 0 ? "-" : ""
  return `${sign}${SYMBOL[currency]}${groupByCurrency(Math.abs(value), currency)}`
}

/** Atajo CLP (sin decimales). */
export function formatCLP(n: number): string {
  return formatMoney(n, "CLP")
}

/** Versión compacta: "$2.3M", "+$441k". */
export function formatCompact(n: number, withSign = false): string {
  const sign = n < 0 ? "-" : withSign ? "+" : ""
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1000)}k`
  return `${sign}$${groupByCurrency(Math.round(abs), "CLP")}`
}

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
]

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? ""
}

const dateHeaderFmt = new Intl.DateTimeFormat("es-CL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
})

/**
 * Zona horaria del negocio. Las fechas de movimiento son días CIVILES (`@db.Date`, medianoche UTC):
 * el 30 de julio es el 30 de julio, no un instante. Pero "hoy" sí depende de un reloj, y el reloj
 * que importa es el del usuario, no el de Greenwich: a las 21:00 en Chile ya es el día siguiente en
 * UTC, y sin esto un movimiento de hoy se rotulaba "Ayer" y el mes en curso saltaba antes de tiempo.
 * Fija (Luca Plan es una app chilena, CLP y es-CL) para que cliente y servidor coincidan siempre.
 */
export const APP_TZ = "America/Santiago"

// en-CA formatea como YYYY-MM-DD, que es justo la clave de día civil que usa la app.
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** Día civil del usuario en formato YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  return dayKeyFmt.format(now)
}

/** Año, mes (1-12) y día del calendario del usuario. Fuente única del "ahora" en toda la app. */
export function currentPeriod(now: Date = new Date()): {
  year: number
  month: number
  day: number
} {
  const [year, month, day] = todayKey(now).split("-").map(Number)
  return { year, month, day }
}

/** Días que quedan del mes en curso, contando hoy. */
export function daysLeftInMonth(now: Date = new Date()): number {
  const { year, month, day } = currentPeriod(now)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return lastDay - day + 1
}

/** Encabezado de grupo por fecha: "Hoy", "Ayer" o "Martes 9 de julio". */
/** "lunes 8 de septiembre", siempre con la fecha (sin el atajo Hoy/Ayer de las cabeceras). */
export function formatLongDate(iso: string): string {
  return dateHeaderFmt.format(new Date(iso))
}

export function formatDateHeader(iso: string): string {
  const key = iso.slice(0, 10) // YYYY-MM-DD del @db.Date (día civil)
  const now = new Date()
  if (key === todayKey(now)) return "Hoy"
  if (key === todayKey(new Date(now.getTime() - 86_400_000))) return "Ayer"
  const s = dateHeaderFmt.format(new Date(iso))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Color de token CSS según el estado de la categoría. */
export function statusVar(status: string): string {
  if (status === "bueno") return "var(--success)"
  if (status === "moderado") return "var(--warning)"
  return "var(--destructive)" // completado / excedido
}

/** Color de token CSS por cuartil de uso del presupuesto (verde → azul → ámbar → rojo). */
export function quartileVar(percent: number): string {
  if (percent < 25) return "var(--success)"
  if (percent < 50) return "var(--primary)"
  if (percent < 75) return "var(--warning)"
  return "var(--destructive)"
}

/**
 * Porcentaje usado de un límite, para MOSTRARLO como cifra. `null` con límite 0, que es un estado
 * válido (`setMonthlyBudget` acepta entero ≥ 0): ahí no hay proporción que calcular — gastar sobre
 * un tope de cero es "te pasaste", no un %. Sin ese null la división imprimía `Infinity%` con
 * gasto y `NaN%` sin él.
 */
export function usagePct(amount: number, limit: number): number | null {
  return limit > 0 ? (amount / limit) * 100 : null
}

/**
 * Cuánto de la barra ocupa `amount` sobre `limit`, acotado a 0–100. La barra sí necesita un número
 * aunque el límite sea 0: se llena si hay algo gastado y queda vacía si no. Es el mismo criterio
 * que `categoryStatus` aplica a las categorías con tope 0 (excedido con uso, bueno sin él), y por
 * eso `quartileVar` de esta cifra da los mismos colores.
 */
export function usageBarPct(amount: number, limit: number): number {
  return Math.min(100, usagePct(amount, limit) ?? (amount > 0 ? 100 : 0))
}

/**
 * Línea de uso del presupuesto de una categoría, para el modal de movimiento. Solo gasto: los
 * ingresos no consumen presupuesto → null (la línea no se muestra). Con tope, el texto es el mismo
 * del dashboard ("$X de $Y") y el color el del semáforo (`statusVar` del status que ya calculó el
 * servidor). Sin tope definido, solo el monto usado y sin color de alerta — mismo criterio que el
 * grupo "sin tope" del dashboard.
 */
export function categoryUsageLine(c: {
  type: string
  used: number
  limit: number
  status: string
}): { text: string; color: string | null } | null {
  if (c.type !== "expense") return null
  if (c.limit > 0)
    return {
      text: `${formatCLP(c.used)} de ${formatCLP(c.limit)}`,
      color: statusVar(c.status),
    }
  return { text: `sin tope · ${formatCLP(c.used)}`, color: null }
}
