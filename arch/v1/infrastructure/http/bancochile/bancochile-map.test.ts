// Mapeo crudo BCH → dominio, con fixtures ANONIMIZADOS (sin datos reales). Verifica offline:
// cuentas/buckets, sobregiro, USD a centavos, signo cargo/abono, ámbito NAC/INT.
// node --test arch/v1/infrastructure/http/bancochile/bancochile-map.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapProducts, mapCartolaMovimientos, mapNoFacturados } from "./bancochile-map.ts";

const productos = {
  rut: "1-9",
  nombre: "Persona Ejemplo",
  productos: [
    { id: "CTA1", numero: "1111", mascara: "****1111", codigo: "CTD", codigoMoneda: "CLP", claseCuenta: "CCNMN1", label: "Cuenta Corriente" },
    { id: "LCD1", numero: "2222", mascara: "****2222", codigo: "LCD", codigoMoneda: "CLP", label: "Línea de Crédito" },
    { id: "TC1", numero: "", mascara: "****9999", codigo: "TNM", codigoMoneda: "CLP", label: "Tarjeta" },
  ],
};
const saldos = [
  { codProducto: "CTD", tipo: "CUENTA_CORRIENTE", numero: "1111", disponible: 34210, cupo: 34210, moneda: "CLP" },
  { codProducto: "LCD", tipo: "LINEA_CREDITO", numero: "2222", disponible: 900000, cupo: 1000000, moneda: "CLP" },
];
const infoTarjetas = [{ idProducto: "TC1", marca: "Visa", tipo: "Signature", numero: "************9999" }];
const tarjetaSaldos = {
  TC1: {
    cupoTotalNacional: 3272200, cupoUtilizadoNacional: 2139851, cupoDisponibleNacional: 1132349,
    cupoTotalInternacional: 2100, cupoUtilizadoInternacional: 48.51, cupoDisponibleInternacional: 2051.49,
  },
};

test("mapProducts: cuenta corriente con cash + overdraft (línea), tarjeta con cupos NAC/INT", () => {
  const snap = mapProducts({ saldos, productos, infoTarjetas, tarjetaSaldos });
  assert.equal(snap.products.length, 2); // corriente + tarjeta (la LCD no es producto propio)

  const cta = snap.products.find((p) => p.rawType === "CUENTA_CORRIENTE")!;
  assert.equal(cta.last4, "1111");
  const cash = cta.buckets.find((b) => b.kind === "cash")!;
  assert.equal(cash.available, 34210);
  const over = cta.buckets.find((b) => b.kind === "overdraft")!;
  assert.equal(over.limit, 1000000);
  assert.equal(over.available, 900000);
  assert.equal(over.used, null); // lo calcula el use-case (autorizado − disponible = 100000)

  const tc = snap.products.find((p) => p.rawType === "TARJETA_CREDITO")!;
  assert.equal(tc.last4, "9999");
  const nac = tc.buckets.find((b) => b.kind === "credit_national")!;
  assert.equal(nac.currency, "CLP");
  assert.equal(nac.used, 2139851);
  const intl = tc.buckets.find((b) => b.kind === "credit_international")!;
  assert.equal(intl.currency, "USD");
  assert.equal(intl.limit, 210000); // 2100 USD → 210000 centavos
  assert.equal(intl.used, 4851); // 48.51 USD → 4851 centavos
});

test("mapCartolaMovimientos: cargo = gasto (−), abono = ingreso (+); id estable", () => {
  const movs = mapCartolaMovimientos([
    { id: "m1", descripcion: "Compra", monto: "3000", tipo: "cargo", fecha: "20260710 10:00:00" },
    { id: "m2", descripcion: "Sueldo", monto: "500000", tipo: "abono", fecha: "20260705 09:00:00" },
  ]);
  assert.equal(movs[0].externalId, "m1");
  assert.equal(movs[0].amount, -3000);
  assert.equal(movs[1].amount, 500000);
  assert.equal(movs[0].date.getUTCMonth(), 6); // julio (0-indexed)
});

test("mapNoFacturados: NAC en CLP directo; INT (codigoMonedaOrigen 840=USD) se convierte con el índice", () => {
  const nf = mapNoFacturados(
    [
      { origenTransaccion: "NAC", glosaTransaccion: "Clinica", montoCompra: 86795, codigoMonedaOrigen: 152, fechaTransaccion: 1783656000000, despliegueCuotas: "01/01" },
      { origenTransaccion: "INT", glosaTransaccion: "AWS", montoCompra: 48.51, codigoMonedaOrigen: 840, fechaTransaccion: 1783656000000, despliegueCuotas: "03/12" },
    ],
    950, // índice USD→CLP
  );
  assert.equal(nf[0].scope, "national");
  assert.equal(nf[0].currency, "CLP");
  assert.equal(nf[0].amount, 86795); // CLP directo
  assert.equal(nf[1].scope, "international");
  assert.equal(nf[1].currency, "CLP");
  assert.equal(nf[1].amount, Math.round(48.51 * 950)); // US$48,51 × 950 = 46.085 CLP (no $48 ni millones)
  assert.deepEqual(nf[1].installments, { current: 3, total: 12 });
});
