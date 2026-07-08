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

/** Color de token CSS según el estado de la categoría. */
export function statusVar(status: string): string {
  if (status === "bueno") return "var(--success)";
  if (status === "moderado") return "var(--warning)";
  return "var(--destructive)"; // completado / excedido
}
