// WDC-171 · el dólar observado de mindicador.cl, sin tasa de respaldo inventada.
// Corre con: node --test arch/v1/infrastructure/http/exchange/usd-clp.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { exchangeRateProvider } from "./usd-clp.ts"

// Años distintos por caso: el módulo guarda la serie por año en memoria.
test("pres-usd-proveedor: si mindicador no responde no hay tasa (null), no un 950 fijo", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ serie: [{ fecha: "2031-03-07T03:00:00.000Z", valor: 912.34 }] }))
  )
  // Con serie: el sábado 8-mar usa el observado del viernes 7.
  assert.equal(await exchangeRateProvider.clpPerUsdAt(new Date("2031-03-08T00:00:00Z")), 912.34)

  t.mock.method(globalThis, "fetch", async () => { throw new Error("sin red") })
  assert.equal(await exchangeRateProvider.clpPerUsdAt(new Date("2032-03-08T00:00:00Z")), null)
  t.mock.method(globalThis, "fetch", async () => new Response("caído", { status: 503 }))
  assert.equal(await exchangeRateProvider.clpPerUsdAt(new Date("2033-03-08T00:00:00Z")), null)
})
