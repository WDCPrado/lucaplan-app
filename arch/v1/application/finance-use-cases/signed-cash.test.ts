import { test } from "node:test";
import assert from "node:assert/strict";
import { Money } from "../../domain/finance/money.ts";
import { applyDebitToCash, applyInternalCredit } from "./email-projection.ts";

const clp = (n: number) => Money.of(n, "CLP");
const cash = { limitAmount: clp(0), used: clp(0), available: clp(-110_517) };
const overdraft = {
  limitAmount: clp(1_000_000),
  used: clp(0),
  available: clp(1_000_000),
};

test("un cargo posterior no traslada el saldo negativo confirmado a la línea", () => {
  const next = applyDebitToCash(cash, overdraft, clp(10_000));
  assert.equal(next.cash.available.toMajor(), -120_517);
  assert.deepEqual(next.overdraft, overdraft);
});

test("los abonos reducen el saldo negativo hasta volverlo positivo sin tocar la línea", () => {
  const first = applyInternalCredit(cash, overdraft, clp(100_000));
  assert.equal(first.cash.available.toMajor(), -10_517);
  const next = applyInternalCredit(first.cash, first.overdraft, clp(20_000));
  assert.equal(next.cash.available.toMajor(), 9_483);
  assert.deepEqual(next.overdraft, overdraft);
});

test("la proyección existente de caja positiva sigue usando la línea por el exceso", () => {
  const next = applyDebitToCash(
    { ...cash, available: clp(5_000) },
    overdraft,
    clp(10_000),
  );
  assert.equal(next.cash.available.toMajor(), 0);
  assert.equal(next.overdraft?.used.toMajor(), 5_000);
  assert.equal(next.overdraft?.available.toMajor(), 995_000);
});
