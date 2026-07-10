// Resolvedor de arte de tarjeta. Corre con: node --test lib/bank-cards.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCardArt, variantForType } from "./bank-cards.ts";

test("variante por tipo de cuenta", () => {
  assert.equal(variantForType("checking"), "debito");
  assert.equal(variantForType("credit_card"), "credito");
  assert.equal(variantForType("savings"), null);
  assert.equal(variantForType("wallet"), null);
});

test("resuelve el arte de Banco de Chile", () => {
  assert.deepEqual(resolveCardArt("Banco de Chile", "checking"), { variant: "debito", icon: "/imagenes/bancos/banco-chile/bch.png" });
  assert.deepEqual(resolveCardArt("Banco de Chile", "credit_card"), { variant: "credito", icon: "/imagenes/bancos/banco-chile/bch.png" });
});

test("banco sin arte cae a fallback (null)", () => {
  assert.equal(resolveCardArt("Santander", "checking"), null);
});

test("tipo sin tarjeta no tiene arte", () => {
  assert.equal(resolveCardArt("Banco de Chile", "savings"), null);
});
