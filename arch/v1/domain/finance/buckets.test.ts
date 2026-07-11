// Invariantes de buckets/sobregiro. Corre con:
//   node --test arch/v1/domain/finance/buckets.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Money } from "./money.ts";
import { bucketIsCash, overdraftUsed, BUCKET_KINDS } from "./finance.domain.ts";

test("overdraftUsed = autorizado − disponible (caso BCH: línea 1M sin usar ⇒ 0)", () => {
  const limit = Money.of(1_000_000, "CLP");
  const available = Money.of(1_000_000, "CLP");
  assert.equal(overdraftUsed(limit, available).toMajor(), 0);
});

test("overdraftUsed refleja la deuda al girar contra la línea (900k disp ⇒ 100k usado)", () => {
  const used = overdraftUsed(Money.of(1_000_000, "CLP"), Money.of(900_000, "CLP"));
  assert.equal(used.toMajor(), 100_000);
});

test("solo `cash` cuenta como caja activa", () => {
  assert.equal(bucketIsCash("cash"), true);
  for (const k of BUCKET_KINDS.filter((k) => k !== "cash")) {
    assert.equal(bucketIsCash(k), false);
  }
});

test("overdraftUsed no mezcla monedas (CLP vs USD lanza)", () => {
  assert.throws(() => overdraftUsed(Money.of(1000, "CLP"), Money.of(1000, "USD")));
});
