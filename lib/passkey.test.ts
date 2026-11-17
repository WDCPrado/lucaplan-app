import assert from "node:assert/strict"
import test from "node:test"
import {
  addPasskeyMessage,
  passkeyDeviceName,
  signInPasskeyMessage,
} from "./passkey.ts"

test("nombra el aparato como aparato · navegador", () => {
  assert.equal(
    passkeyDeviceName(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    ),
    "iPhone · Safari"
  )
  assert.equal(
    passkeyDeviceName(
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"
    ),
    "Android · Chrome"
  )
  assert.equal(
    passkeyDeviceName(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0"
    ),
    "Computador · Edge"
  )
  assert.equal(passkeyDeviceName(""), "Computador · Navegador")
})

test("cancelar el diálogo del sistema no muestra error", () => {
  for (const code of [
    "ERROR_CEREMONY_ABORTED",
    "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
    "AUTH_CANCELLED",
  ]) {
    assert.equal(signInPasskeyMessage({ code, status: 400 }, false), null)
    if (code !== "AUTH_CANCELLED")
      assert.equal(addPasskeyMessage({ code, status: 400 }), null)
  }
})

test("los errores de entrar y de agregar tienen su mensaje", () => {
  assert.match(
    signInPasskeyMessage({ code: "PASSKEY_NOT_FOUND", status: 401 }, true)!,
    /no tiene biometría guardada/
  )
  assert.match(
    signInPasskeyMessage({ code: "AUTH_CANCELLED", status: 400 }, true)!,
    /Revisa la conexión/
  )
  assert.match(
    signInPasskeyMessage({ code: "BANNED_USER", status: 403 }, true)!,
    /Si tu cuenta sigue activa/
  )
  assert.equal(
    addPasskeyMessage({
      code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
      status: 400,
    }),
    "Este aparato ya está registrado en tu cuenta."
  )
})
