// Tipo de cambio USD→CLP (dólar observado) desde mindicador.cl — API pública chilena, gratis y sin
// key. Se usa para convertir los movimientos internacionales de tarjeta (montoCompra en USD) a CLP.
// Best-effort: si la API falla, cae a un valor aproximado para no perder el gasto.
const FALLBACK_CLP_PER_USD = 950 // ponytail: aproximado de respaldo si mindicador no responde.

export async function getUsdClpRate(): Promise<number> {
  try {
    const res = await fetch("https://mindicador.cl/api/dolar", {
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const data = (await res.json()) as { serie?: { valor?: number }[] }
      const valor = data?.serie?.[0]?.valor
      if (typeof valor === "number" && valor > 0) return valor
    }
  } catch {
    /* red/timeout → fallback */
  }
  return FALLBACK_CLP_PER_USD
}
