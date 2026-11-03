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

test("pres-usd-serie-vacia: un año sin publicar no se cachea vacío; el 1-ene usa el último observado del 31-dic", async (t) => {
  const pedidos: string[] = []
  let publicado = false
  t.mock.method(globalThis, "fetch", async (url: string) => {
    pedidos.push(url)
    if (url.endsWith("/2040"))
      return new Response(JSON.stringify({ serie: publicado ? [{ fecha: "2040-01-02T03:00:00.000Z", valor: 990 }] : [] }))
    return new Response(JSON.stringify({ serie: [
      { fecha: "2039-12-31T03:00:00.000Z", valor: 955.5 },
      { fecha: "2039-12-30T03:00:00.000Z", valor: 950 },
    ] }))
  })
  // 1-ene-2040 sin dato del año: cae al 31-dic-2039.
  assert.equal(await exchangeRateProvider.clpPerUsdAt(new Date("2040-01-01T00:00:00Z")), 955.5)
  // La serie vacía de 2040 no quedó en cache: al publicarse, el 2-ene ya usa su propio observado.
  publicado = true
  assert.equal(await exchangeRateProvider.clpPerUsdAt(new Date("2040-01-02T00:00:00Z")), 990)
  assert.equal(pedidos.filter((u) => u.endsWith("/2040")).length, 2)
  // Y el 1-ene sigue usando el 31-dic aunque 2040 ya tenga datos posteriores.
  assert.equal(await exchangeRateProvider.clpPerUsdAt(new Date("2040-01-01T00:00:00Z")), 955.5)
})
