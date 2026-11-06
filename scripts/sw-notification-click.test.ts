import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import vm from "node:vm"

// Corre el `notificationclick` real de public/sw.js con un `self` falso y registra qué le pide al
// navegador, en orden.
const SW = readFileSync(join(import.meta.dirname, "../public/sw.js"), "utf8")
const ORIGIN = "https://lucaplan.test"

type FakeWindow = {
  url: string
  focused?: boolean
  visibilityState?: string
  navigateFails?: boolean
}

async function tap(url: string | undefined, windows: FakeWindow[]) {
  const calls: string[] = []
  const handlers: Record<string, (e: unknown) => void> = {}
  const clients = windows.map((w) => {
    const c = {
      ...w,
      focus: async () => {
        calls.push(`focus ${c.url}`)
        return c
      },
      navigate: async (to: string) => {
        calls.push(`navigate ${to}`)
        if (w.navigateFails) throw new TypeError("navigate failed")
        c.url = to
        return c
      },
      postMessage: (msg: { type: string; url: string }) =>
        calls.push(`postMessage ${msg.type} ${msg.url}`),
    }
    return c
  })
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    clients: {
      matchAll: async () => clients,
      openWindow: async (to: string) => {
        calls.push(`openWindow ${to}`)
        return null
      },
    },
  }
  vm.runInNewContext(SW, { self, URL, caches: {}, fetch })
  let done: Promise<unknown> = Promise.resolve()
  handlers.notificationclick({
    notification: { data: { url }, close: () => calls.push("close") },
    waitUntil: (p: Promise<unknown>) => (done = p),
  })
  await done
  return calls
}

test("con la PWA abierta enfoca antes de navegar (el permiso de traerla al frente expira)", async () => {
  const calls = await tap("/dashboard?tx=abc", [{ url: `${ORIGIN}/movements` }])
  assert.deepEqual(calls, [
    "close",
    `focus ${ORIGIN}/movements`,
    `navigate ${ORIGIN}/dashboard?tx=abc`,
  ])
})

test("si el navegador no deja navegar (iOS), le pide a la página que vaya ella", async () => {
  const calls = await tap("/recurring#cuotas", [
    { url: `${ORIGIN}/dashboard`, navigateFails: true },
  ])
  assert.deepEqual(calls.slice(-1), [`postMessage navigate ${ORIGIN}/recurring#cuotas`])
  assert.ok(!calls.some((c) => c.startsWith("openWindow")), "no abre otra ventana")
})

test("usa la ventana que el usuario está viendo, no la primera de la lista", async () => {
  const calls = await tap("/movements?categoryId=c1", [
    { url: `${ORIGIN}/settings`, visibilityState: "hidden" },
    { url: `${ORIGIN}/dashboard`, focused: true, visibilityState: "visible" },
  ])
  assert.equal(calls[1], `focus ${ORIGIN}/dashboard`)
})

test("sin ventana abre la URL del aviso; otro origen cae al dashboard", async () => {
  assert.deepEqual(await tap("/movements", []), ["close", `openWindow ${ORIGIN}/movements`])
  assert.deepEqual(await tap("https://evil.test/x", []), [
    "close",
    `openWindow ${ORIGIN}/dashboard`,
  ])
})
