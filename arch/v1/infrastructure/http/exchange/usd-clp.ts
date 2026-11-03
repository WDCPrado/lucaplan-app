// Tipo de cambio USD→CLP (dólar observado) desde mindicador.cl — API pública chilena, gratis y sin
// key. Convierte los movimientos internacionales de tarjeta (montoCompra en USD) a CLP para que
// entren en los cálculos. Se pide el rate de la FECHA del movimiento (el observado histórico no
// cambia → el CLP estimado es estable). Si la API falla no hay tasa (null): nunca un aproximado fijo.
import type { ExchangeRateProvider } from "../../../domain/finance/exchange.domain.ts"

type Series = { byDay: Map<string, number>; latest: number | null }

// Cache por año (in-flight incluida): los valores históricos no cambian, así que una vez cargado
// el año se reutiliza. Vive en el módulo (por proceso); en serverless se recalienta sin problema.
const yearCache = new Map<number, Promise<Series | null>>()

const dayKey = (d: Date) => d.toISOString().slice(0, 10) // yyyy-mm-dd (UTC)

async function fetchYear(year: number): Promise<Series> {
  const res = await fetch(`https://mindicador.cl/api/dolar/${year}`, {
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`mindicador ${res.status}`)
  const data = (await res.json()) as {
    serie?: { fecha?: string; valor?: number }[]
  }
  const byDay = new Map<string, number>()
  let latest: number | null = null
  for (const p of data.serie ?? []) {
    if (!p.fecha || typeof p.valor !== "number" || p.valor <= 0) continue
    byDay.set(dayKey(new Date(p.fecha)), p.valor)
    if (latest === null) latest = p.valor // la serie viene de más reciente a más antiguo
  }
  return { byDay, latest }
}

// null = la API falló. Ni un fallo ni una serie vacía (año que aún no publica) se cachean: el
// próximo request reintenta.
function seriesForYear(year: number): Promise<Series | null> {
  let s = yearCache.get(year)
  if (!s) {
    s = fetchYear(year)
      .catch(() => null)
      .then((series) => {
        if (!series || series.byDay.size === 0) yearCache.delete(year)
        return series
      })
    yearCache.set(year, s)
  }
  return s
}

export const exchangeRateProvider: ExchangeRateProvider = {
  async clpPerUsdAt(date) {
    const series = await seriesForYear(date.getUTCFullYear())
    if (!series) return null // la API falló: sin tasa, nunca la de otro año
    // El observado del día o el más cercano anterior del mismo año (finde, feriado o una fecha
    // reciente sin publicar aún). Las claves yyyy-mm-dd ordenan como fechas.
    const target = dayKey(date)
    let best: string | null = null
    for (const day of series.byDay.keys())
      if (day <= target && (best === null || day > best)) best = day
    if (best) return series.byDay.get(best) ?? null
    // Nada antes en ese año (el 1-ene usa el 31-dic): el último observado del año anterior.
    return (await seriesForYear(date.getUTCFullYear() - 1))?.latest ?? null
  },
}
