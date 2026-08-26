// El estado OAuth es lo único que sobrevive el viaje al proveedor, y ahora lleva dentro CON QUÉ
// proveedor se está hablando: si eso se pudiera alterar desde el navegador, el callback canjearía
// el código contra otra consola. Estos tests cubren que viaja y que no se puede tocar.
// node --test arch/v1/infrastructure/http/email/oauth-state.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

// Llave fija: el test no toca el archivo de llave local ni depende del entorno.
process.env.BANCOCHILE_ENC_KEY =
  "llave-de-prueba-solo-para-tests-32-chars-minimo"

const { signOAuthState, verifyOAuthState } = await import("./oauth-state.ts")
const { OAuthStateError } = await import(
  "../../../domain/finance/email-connection.domain.ts"
)

test("el proveedor viaja en el estado y vuelve intacto junto al banco y la etiqueta", () => {
  const state = signOAuthState("user-1", {
    provider: "gmail",
    bankProvider: "bancochile",
    label: "Empresa",
  })
  assert.deepEqual(verifyOAuthState(state, "user-1"), {
    provider: "gmail",
    bankProvider: "bancochile",
    label: "Empresa",
  })
})

// Reconexión pura: sin banco ni etiqueta, pero con proveedor. El callback distingue este caso.
test("sin banco el estado igual dice de qué proveedor es", () => {
  const state = signOAuthState("user-1", { provider: "outlook" })
  const intent = verifyOAuthState(state, "user-1")
  assert.equal(intent.provider, "outlook")
  assert.equal(intent.bankProvider, undefined)
  assert.equal(intent.label, null)
})

// Un estado viejo (emitido antes de que el proveedor viajara) no trae `provider`: el callback cae
// al proveedor por defecto en vez de romper el flujo del usuario.
test("un estado sin proveedor se verifica igual y lo deja indefinido", () => {
  const state = signOAuthState("user-1", { bankProvider: "bice" })
  assert.equal(verifyOAuthState(state, "user-1").provider, undefined)
})

test("cambiar el proveedor del estado rompe la firma", () => {
  const state = signOAuthState("user-1", {
    provider: "outlook",
    bankProvider: "bancochile",
  })
  const [payload, sig] = state.split(".")
  const decoded = JSON.parse(
    Buffer.from(
      payload.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8")
  )
  decoded.p = "proveedor-del-atacante"
  const forged = Buffer.from(JSON.stringify(decoded))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
  assert.throws(
    () => verifyOAuthState(`${forged}.${sig}`, "user-1"),
    OAuthStateError
  )
})

test("el estado de otro usuario y el vencido se rechazan", () => {
  const state = signOAuthState("user-1", { provider: "outlook" })
  assert.throws(() => verifyOAuthState(state, "user-2"), OAuthStateError)
  assert.throws(
    () => verifyOAuthState(state, "user-1", new Date(Date.now() + 11 * 60_000)),
    OAuthStateError
  )
})
