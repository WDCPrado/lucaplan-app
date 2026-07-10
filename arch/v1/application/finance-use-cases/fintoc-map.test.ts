// Mapeo Fintoc → dominio. Corre con: node --test arch/v1/application/finance-use-cases/fintoc-map.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapAccountType, mapStatus, mapProviderAccount, mapProviderMovement } from "./fintoc-map.ts";
import type { ProviderAccount, ProviderMovement } from "../../domain/finance/bank-aggregation.port.ts";

test("mapAccountType: corriente/vista → checking; crédito → credit_card; desconocido → wallet", () => {
  assert.equal(mapAccountType("checking_account"), "checking");
  assert.equal(mapAccountType("sight_account"), "checking");
  assert.equal(mapAccountType("savings_account"), "savings");
  assert.equal(mapAccountType("credit_card"), "credit_card");
  assert.equal(mapAccountType("rare_thing"), "wallet");
});

test("mapStatus: usa el status del proveedor; si falta, deriva de pending", () => {
  assert.equal(mapStatus("reversed", false), "reversed");
  assert.equal(mapStatus(null, true), "pending");
  assert.equal(mapStatus(null, false), "confirmed");
  assert.equal(mapStatus("weird", false), "confirmed");
});

const pAccount = (over: Partial<ProviderAccount>): ProviderAccount => ({
  externalId: "acc_1",
  name: "Cuenta",
  officialName: null,
  rawType: "checking_account",
  currency: "CLP",
  numberLast4: "8842",
  balanceCurrent: 1000,
  balanceLimit: 200000,
  ...over,
});

test("mapProviderAccount: monto en unidad mínima (CLP=pesos, USD=centavos); moneda no soportada → null", () => {
  const clp = mapProviderAccount(pAccount({}));
  assert.equal(clp?.balance.toMajor(), 1000);
  assert.equal(clp?.currency, "CLP");
  assert.equal(clp?.cardLast4, "8842");
  const usd = mapProviderAccount(pAccount({ currency: "USD", balanceCurrent: 12345 }));
  assert.equal(usd?.balance.toMajor(), 123.45); // centavos → dólares
  assert.equal(mapProviderAccount(pAccount({ currency: "EUR" })), null);
});

const pMov = (over: Partial<ProviderMovement>): ProviderMovement => ({
  externalId: "mov_1",
  description: "x",
  amount: 5000,
  currency: "CLP",
  postDate: "2026-07-01T00:00:00.000Z",
  transactionDate: "2026-07-01T10:00:00.000Z",
  status: "confirmed",
  pending: false,
  ...over,
});

test("mapProviderMovement: +monto=credit, −monto=debit (valor absoluto); moneda no soportada → null", () => {
  const ingreso = mapProviderMovement(pMov({ amount: 5000 }));
  assert.equal(ingreso?.direction, "credit");
  assert.equal(ingreso?.amount.toMajor(), 5000);
  const gasto = mapProviderMovement(pMov({ amount: -3000 }));
  assert.equal(gasto?.direction, "debit");
  assert.equal(gasto?.amount.toMajor(), 3000);
  assert.equal(mapProviderMovement(pMov({ currency: "GBP" })), null);
});
