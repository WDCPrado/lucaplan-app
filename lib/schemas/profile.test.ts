import { test } from "node:test"
import assert from "node:assert/strict"
import { changePasswordSchema, profileNameSchema } from "./profile.ts"

test("El nombre se guarda sin espacios a los lados y no puede quedar vacío.", () => {
  assert.equal(profileNameSchema.parse({ name: "  Willy " }).name, "Willy")
  assert.equal(profileNameSchema.safeParse({ name: "   " }).success, false)
})

test("La nueva contraseña pide 8 caracteres y que la repetición coincida.", () => {
  const ok = { currentPassword: "a", newPassword: "12345678", confirmPassword: "12345678" }
  assert.equal(changePasswordSchema.safeParse(ok).success, true)
  const short = changePasswordSchema.safeParse({ ...ok, newPassword: "1234567", confirmPassword: "1234567" })
  assert.deepEqual(short.error?.issues.map((i) => i.path[0]), ["newPassword"])
  const mismatch = changePasswordSchema.safeParse({ ...ok, confirmPassword: "87654321" })
  assert.deepEqual(mismatch.error?.issues.map((i) => i.path[0]), ["confirmPassword"])
})
