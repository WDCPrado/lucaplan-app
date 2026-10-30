import assert from "node:assert/strict"
import test from "node:test"
import { mailAppsFor, maskEmail } from "./mail-apps.ts"
import {
  loginCodeSchema,
  loginEmailSchema,
  loginErrorMessage,
} from "./schemas/login-code.ts"

test("ofrece el webmail adecuado o ambos para dominio propio", () => {
  for (const email of ["person@gmail.com", "person@GOOGLEMAIL.COM"])
    assert.deepEqual(
      mailAppsFor(email).map((a) => a.label),
      ["Gmail"]
    )
  for (const email of [
    "person@hotmail.cl",
    "person@outlook.com",
    "person@live.cl",
    "person@msn.com",
  ])
    assert.deepEqual(
      mailAppsFor(email).map((a) => a.label),
      ["Outlook"]
    )
  assert.deepEqual(
    mailAppsFor("person@example.com").map((a) => a.label),
    ["Gmail", "Outlook"]
  )
  assert.match(
    mailAppsFor("person+test@gmail.com")[0].href,
    /person%2Btest%40gmail.com/
  )
  assert.equal(maskEmail("persona@example.com"), "pe•••••@example.com")
  assert.equal(maskEmail("a@example.com"), "a•••@example.com")
})

test("normaliza correo y solo acepta seis dígitos; errores ofrecen recuperación", () => {
  assert.equal(loginEmailSchema.parse(" Test@Example.com "), "test@example.com")
  assert.equal(loginEmailSchema.safeParse("no-email").success, false)
  for (const code of ["12345", "1234567", "12a456", "１２３４５６"])
    assert.equal(loginCodeSchema.safeParse(code).success, false)
  assert.equal(loginCodeSchema.safeParse("012345").success, true)
  assert.match(loginErrorMessage(429), /Espera un minuto/)
  assert.match(loginErrorMessage(400, true), /pide uno nuevo/)
  assert.match(loginErrorMessage(undefined), /conexión/)
})
