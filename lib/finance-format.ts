// Formato de montos y periodos para la UI financiera.
import { CURRENCY_DECIMALS, type CurrencyCode } from "@/arch/v1/domain/finance/money";

const groupFmt = (currency: CurrencyCode) =>
  new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: CURRENCY_DECIMALS[currency],
    maximumFractionDigits: CURRENCY_DECIMALS[currency],
  });

/** Número agrupado según la moneda, SIN símbolo (para inputs). Ej. CLP 12965→"12.965", USD 19.1→"19,10". */
export function groupByCurrency(value: number, currency: CurrencyCode): string {
  return groupFmt(currency).format(value);
}

/** Monto con símbolo, decimales por moneda y signo. Ej. "$12.965", "-$19,10". Fuente única de formato. */
export function formatMoney(value: number, currency: CurrencyCode): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${groupByCurrency(Math.abs(value), currency)}`;
}

/** Atajo CLP (sin decimales). */
export function formatCLP(n: number): string {
  return formatMoney(n, "CLP");
}

/** Versión compacta: "$2.3M", "+$441k". */
export function formatCompact(n: number, withSign = false): string {
  const sign = n < 0 ? "-" : withSign ? "+" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1000)}k`;
  return `${sign}$${groupByCurrency(Math.round(abs), "CLP")}`;
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
];

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? "";
}

const shortDate = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" });

/** Fecha corta de un movimiento: "3 jul". */
export function formatShortDate(iso: string): string {
  return shortDate.format(new Date(iso));
}

const dateHeaderFmt = new Intl.DateTimeFormat("es-CL", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** Encabezado de grupo por fecha: "Hoy", "Ayer" o "Martes 9 de julio". Compara en UTC (como el `@db.Date`). */
export function formatDateHeader(iso: string): string {
  const key = iso.slice(0, 10); // YYYY-MM-DD (UTC)
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const yesterdayKey = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (key === todayKey) return "Hoy";
  if (key === yesterdayKey) return "Ayer";
  const s = dateHeaderFmt.format(new Date(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Color de token CSS según el estado de la categoría. */
export function statusVar(status: string): string {
  if (status === "bueno") return "var(--success)";
  if (status === "moderado") return "var(--warning)";
  return "var(--destructive)"; // completado / excedido
}
