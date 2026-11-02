// Tipo de cambio USD→CLP (dólar observado) desde mindicador.cl — API pública chilena, gratis y sin
// key. Convierte los movimientos internacionales de tarjeta (montoCompra en USD) a CLP para que
// entren en los cálculos. Se pide el rate de la FECHA del movimiento (el observado histórico no
// cambia → el CLP estimado es estable). Si la API falla no hay tasa (null): nunca un aproximado fijo.
import type { ExchangeRateProvider } from "../../../domain/finance/exchange.domain.ts"

type Series = { byDay: Map<string, number>; latest: number | null }

// Cache por año (in-flight incluida): los valores históricos no cambian, así que una vez cargado
// el año se reutiliza. Vive en el módulo (por proceso); en serverless se recalienta sin problema.
const yearCache = new Map<number, Promise<Series>>()

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

function seriesForYear(year: number): Promise<Series> {
  let s = yearCache.get(year)
  if (!s) {
    // Un fallo de red no se cachea como error permanente: se guarda una serie vacía y el próximo
    // request reintenta (borrándola). Mientras tanto no hay tasa.
    s = fetchYear(year).catch(() => {
      yearCache.delete(year)
      return { byDay: new Map(), latest: null } as Series
    })
    yearCache.set(year, s)
  }
  return s
}

export const exchangeRateProvider: ExchangeRateProvider = {
  async clpPerUsdAt(date) {
    const series = await seriesForYear(date.getUTCFullYear())
    // Día exacto o el hábil anterior más cercano (finde/feriado no tienen observado).
    for (let i = 0; i < 8; i++) {
      const d = new Date(date)
      d.setUTCDate(d.getUTCDate() - i)
      const v = series.byDay.get(dayKey(d))
      if (v) return v
    }
    // Sin match (fecha muy reciente sin publicar aún): último observado; serie vacía: sin tasa.
    return series.latest
  },
}
