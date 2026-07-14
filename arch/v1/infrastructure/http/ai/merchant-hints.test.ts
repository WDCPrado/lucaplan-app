// Matching glosa bancaria → comercio. Cubre los bordes que rompen el match ingenuo:
// pasarela pegada al comercio, aliases cortos (falsos positivos), "más largo gana".
// node --test arch/v1/infrastructure/http/ai/merchant-hints.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMerchantIndex, findMerchant, normalizeDesc } from "./merchant-hints.ts";

const catalog = [
  { name: "Cabify", category: "transporte", aliases: ["CABIFY", "CABIFY CHILE"] },
  { name: "Mercado Pago", category: "intermediario_pago", aliases: ["MERCADOPAGO", "MERPAGO", "MPAGO"] },
  { name: "Uber", category: "transporte", aliases: ["UBER"] },
  { name: "Uber Eats", category: "comida", aliases: ["UBER EATS", "UBEREATS"] },
  { name: "Spotify", category: "suscripciones", aliases: ["SPOTIFY"] },
  { name: "LG", category: "tecnologia", aliases: ["LG"] },
];
const idx = buildMerchantIndex(catalog);
const who = (d: string) => findMerchant(idx, d)?.name ?? null;

test("pasarela NO gana: MERPAGOCABIFY... → Cabify (no Mercado Pago)", () => {
  assert.equal(who("MERPAGOCABIFY2629BV7CDHP"), "Cabify");
});
test("alias corto sin falso positivo: LG no matchea dentro de ALGO", () => {
  assert.equal(who("PAGO ALGO RICO SPA"), null);
  assert.equal(who("LG ELECTRONICS CHILE"), "LG");
});
test("el más largo gana: UBER EATS → Uber Eats; UBER RIDES → Uber", () => {
  assert.equal(who("UBER EATS SANTIAGO"), "Uber Eats");
  assert.equal(who("PAYU*UBER RIDES 8324"), "Uber");
});
test("solo pasarela, ningún comercio → fallback a la pasarela", () => {
  assert.equal(who("MERCADOPAGO*RECARGA123"), "Mercado Pago");
});
test("substring pegado a basura: SPOTIFY", () => {
  assert.equal(who("MERPAGO*SPOTIFYXYZ99"), "Spotify");
});
test("sin match → null (transferencia entre personas)", () => {
  assert.equal(who("TRANSFERENCIA A JUAN PEREZ"), null);
});
test("normaliza acentos y signos", () => {
  assert.equal(normalizeDesc("Compra Aquí* SpA"), "COMPRA AQUI SPA");
});
