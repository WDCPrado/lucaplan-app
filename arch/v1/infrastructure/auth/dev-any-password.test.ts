// Camino de seguridad → lleva check. Corre con:
//   node --test arch/v1/infrastructure/auth/dev-any-password.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { devAnyPasswordEnabled } from "./dev-any-password.ts"

test("solo se activa en desarrollo y con el opt-in explícito", () => {
  assert.equal(
    devAnyPasswordEnabled({ NODE_ENV: "development", DEV_ANY_PASSWORD: "true" }),
    true
  )
})

test("producción lo bloquea aunque la env venga activada", () => {
  assert.equal(
    devAnyPasswordEnabled({ NODE_ENV: "production", DEV_ANY_PASSWORD: "true" }),
    false
  )
})

test("desarrollo sin el opt-in no abre el login", () => {
  assert.equal(devAnyPasswordEnabled({ NODE_ENV: "development" }), false)
  assert.equal(
    devAnyPasswordEnabled({ NODE_ENV: "development", DEV_ANY_PASSWORD: "1" }),
    false
  )
})

test("entorno vacío (NODE_ENV sin definir) no lo activa", () => {
  assert.equal(devAnyPasswordEnabled({ DEV_ANY_PASSWORD: "true" }), false)
})
