// Camino de seguridad → lleva check. Corre con:
//   node --test arch/v1/domain/authorization/authorization.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { can } from "./authorization.domain.ts";

test("ADMIN gestiona usuarios y accede a premium", () => {
  assert.equal(can("ADMIN", "user", "ban"), true);
  assert.equal(can("ADMIN", "premium", "access"), true);
});

test("USER no gestiona usuarios ni accede a premium", () => {
  assert.equal(can("USER", "user", "ban"), false);
  assert.equal(can("USER", "premium", "access"), false);
});

test("PREMIUM accede a premium pero no gestiona usuarios", () => {
  assert.equal(can("PREMIUM", "premium", "access"), true);
  assert.equal(can("PREMIUM", "user", "ban"), false);
});
