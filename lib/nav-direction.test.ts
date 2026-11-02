// Corre con: node --test lib/nav-direction.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { navDirection, reverseNav } from "./nav-direction.ts"

const tabs = ["/dashboard", "/recurring", "/movements", "/settings"]

test("entre pestañas sigue su orden", () => {
  assert.equal(navDirection("/dashboard", "/movements", tabs), "down")
  assert.equal(navDirection("/settings", "/recurring", tabs), "up")
})

test("entrar y volver van por profundidad", () => {
  assert.equal(navDirection("/recurring", "/installments", tabs), "forward") // fuera de las pestañas
  assert.equal(navDirection("/installments", "/recurring", tabs), "back")
  assert.equal(navDirection("/movements", "/movements/abc", tabs), "forward")
  assert.equal(navDirection("/movements/abc", "/movements", tabs), "back")
})

test("misma ruta no se mueve, y el atrás invierte", () => {
  assert.equal(navDirection("/dashboard", "/dashboard", tabs), null)
  assert.equal(reverseNav.forward, "back")
  assert.equal(reverseNav.down, "up")
})
