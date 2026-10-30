// Reglas PURAS de qué se notifica y con qué texto. Sin IO: reciben datos ya cargados y devuelven
// el PushMessage o `null` (= no molestar). Todo lo decidible sin base de datos vive aquí, para que
// se pueda testear con `node --test`.
//
// UNA forma para todos los avisos (cada uno pasa por `message`):
// - título: qué pasó, con el dato clave (monto, categoría) adelante, en ≤40 caracteres;
// - cuerpo: la consecuencia o la acción, en ≤90, como oración con punto final;
// - sin emojis; montos con `formatMoney` (CLP y USD nunca se suman entre sí);
// - `tag` por tipo (+ entidad cuando hay una) y `url` a la pantalla que resuelve el aviso.
// Los largos son lo que cabe en ~2 líneas del banner de iOS sin cortarse a media palabra.
import type { CurrencyCode } from "../../domain/finance/money.ts"
import type { PushMessage } from "../../domain/notifications/push.domain.ts"
import { formatMoney } from "../../../../lib/finance-format.ts"

export const TITLE_MAX = 40
export const BODY_MAX = 90

/** Recorta con "…" si no cabe (nombres del banco o del usuario pueden ser de cualquier largo). */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

function message(
  title: string,
  body: string,
  url: string,
  tag: string
): PushMessage {
  return { title: clip(title, TITLE_MAX), body: clip(body, BODY_MAX), url, tag }
}

function money(value: number, currency: CurrencyCode): string {
  return formatMoney(Math.abs(value), currency)
}

/** Total por moneda, nunca convertido: "$32.990" o "$32.990 y US$19,10". */
function totals(items: { amount: number; currency: CurrencyCode }[]): string {
  const byCurrency = new Map<CurrencyCode, number>()
  for (const i of items)
    byCurrency.set(i.currency, (byCurrency.get(i.currency) ?? 0) + Math.abs(i.amount))
  return [...byCurrency].map(([c, v]) => formatMoney(v, c)).join(" y ")
}

/** Bienvenida al activar las notificaciones en un dispositivo. */
export function welcomeMessage(): PushMessage {
  return message(
    "Notificaciones activadas",
    "Te avisaremos de movimientos nuevos, tu presupuesto y pagos por vencer.",
    "/dashboard",
    "welcome"
  )
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
  // Día civil del movimiento (DATE, medianoche UTC): dice en qué mes buscarlo ya persistido.
  // Ausente = se busca en el mes calendario de hoy.
  date?: Date
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
    const kind = m.direction === "debit" ? "Gasto" : "Abono"
    return message(
      `${kind} de ${money(m.amount, m.currency)}${m.category ? ` en ${m.category}` : ""}`,
      // Sin categoría la IA no lo pudo clasificar: no cuenta para el presupuesto hasta que se haga.
      m.category || m.direction === "credit"
        ? `${m.description}.`
        : `${clip(m.description, 40)}. Sin categoría: tócalo para clasificarlo.`,
      // Tocar el aviso abre el movimiento, no una lista donde haya que buscarlo.
      m.id ? `/dashboard?tx=${m.id}` : "/movements",
      "movements"
    )
  }
  // Resumen por moneda (CLP y USD por separado, sin convertir): gastos y abonos.
  const debits = movements.filter((m) => m.direction === "debit")
  const credits = movements.filter((m) => m.direction === "credit")
  const parts = [
    debits.length > 0 ? `Gastos por ${totals(debits)}` : "",
    credits.length > 0 ? `abonos por ${totals(credits)}` : "",
  ].filter(Boolean)
  const body = parts.join("; ")
  return message(
    `${movements.length} movimientos nuevos`,
    `${body.charAt(0).toUpperCase()}${body.slice(1)}.`,
    "/movements",
    "movements"
  )
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
  const suffix =
    real > 100
      ? `: te pasaste (${real}%)`
      : real === 100
        ? ": presupuesto completo"
        : `: ${real}% del presupuesto`
  const spent = `Llevas ${money(usedAfter, currency)} de ${money(limit, currency)}`
  return message(
    // El nombre se recorta para que el % no se pierda al final del título.
    `${clip(category.name, TITLE_MAX - suffix.length)}${suffix}`,
    // El cuerpo mira los montos, no el % redondeado: con 99,6% no se dice "sin margen".
    usedAfter > limit
      ? `${spent}; te pasaste por ${money(usedAfter - limit, currency)}.`
      : usedAfter === limit
        ? `${spent}; no te queda margen este mes.`
        : `${spent}; te quedan ${money(limit - usedAfter, currency)} este mes.`,
    // Los gastos de esa categoría en el período en curso: ahí se ve en qué se fue.
    `/movements?categoryId=${encodeURIComponent(category.id)}`,
    // Una notificación viva por categoría: dos categorías distintas no se pisan entre sí.
    `budget:${category.id}`
  )
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
    ? "/recurring#cuotas"
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
    return message(
      `Vence ${when}: ${i.description}`,
      i.kind === "installment"
        ? `Cuota de ${money(i.amount, i.currency)}. Toca para ver tus cuotas.`
        : `Pago de ${money(i.amount, i.currency)}. Toca para ver tus recurrentes.`,
      dueUrl(due),
      "due"
    )
  }
  const span =
    windowDays === 0
      ? "hoy"
      : windowDays === 1
        ? "hoy o mañana"
        : `en los próximos ${windowDays} días`
  return message(
    `${due.length} pagos vencen ${span}`,
    `Suman ${totals(due)}. Toca para verlos.`,
    dueUrl(due),
    "due"
  )
}
