// Instalación inicial (/setup, WDC-181): corre solo mientras la base no tiene cuentas, protegida
// por un código que el servidor imprime en su consola. El estado (código, sesiones verificadas,
// intentos fallidos) vive en memoria del proceso: si el servidor se reinicia, hay código nuevo.
// Corre con: node --test arch/v1/application/setup-use-cases/setup.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  ensureSetupCode,
  getSetupStatus,
  verifySetupCode,
  updateSetupIntegrations,
} from "./setup-use-cases.ts"
import { createSetupState, type SetupDeps } from "../../domain/setup/setup.domain.ts"
import { resolveIntegration } from "../integration-use-cases/resolve-integration-use-case.ts"
import { integrationCipher } from "../../infrastructure/crypto/integration-cipher.ts"
import { domainErrorStatus } from "../domain-error-status.ts"
import { setupStatus } from "../../../../lib/integration-settings-schemas.ts"
import type { StoredIntegration } from "../../domain/integrations/integrations.domain.ts"

process.env.BANCOCHILE_ENC_KEY = "wdc181-llave-maestra-de-prueba-0123456789abcdef"

const PROD = { NODE_ENV: "production" }
const LOCAL = { NODE_ENV: "development" }
const SECRET = "re_SetupSecretValue1234"
const IP = "203.0.113.7"

// Instalación en memoria: cuentas, app_setting y reloj controlables.
function install(env: Record<string, string | undefined> = PROD, accounts = 0) {
  const rows = new Map<string, StoredIntegration>()
  const writes: string[] = []
  const clock = { now: new Date("2026-11-06T10:00:00-03:00") }
  const s: {
    accounts: number
    rows: typeof rows
    writes: string[]
    clock: typeof clock
    deps: SetupDeps
  } = { accounts, rows, writes, clock, deps: undefined as unknown as SetupDeps }
  s.deps = {
    accounts: { async hasAccounts() { return s.accounts > 0 } },
    state: createSetupState(),
    integrations: {
      settings: {
        async list() { return [...rows.values()] },
        async save(key, value) { writes.push(key); rows.set(key, { key, value, updatedAt: new Date() }) },
        async remove(key) { writes.push(`-${key}`); rows.delete(key) },
      },
      cipher: integrationCipher,
      env,
      cache: new Map(),
    },
    env,
    now: () => clock.now,
  }
  return s
}

async function silenced<T>(t: { mock: typeof test.mock }, fn: () => Promise<T>) {
  const printed: string[] = []
  for (const m of ["log", "info", "warn", "error"] as const)
    t.mock.method(console, m, (...a: unknown[]) => { printed.push(a.map(String).join(" ")) })
  return { printed, result: await fn() }
}

// Código y cookie de una instalación lista para el asistente.
async function verified(t: { mock: typeof test.mock }, s: ReturnType<typeof install>) {
  const { result: code } = await silenced(t, () => ensureSetupCode(s.deps))
  return verifySetupCode(s.deps, { code: code! }, IP)
}

test("con la base vacía, el estado dice que falta instalar; en producción faltan RESEND_API_KEY y RESEND_FROM y en local no falta nada", async () => {
  const prod = install(PROD)
  const status = await getSetupStatus(prod.deps, null)
  setupStatus.parse(status)
  assert.deepEqual(status, { needed: true, verified: false, local: false, missingRequired: ["RESEND_API_KEY", "RESEND_FROM"], integrations: null })
  // Local: el código de acceso sale en la consola, no hace falta Resend.
  assert.deepEqual(await getSetupStatus(install(LOCAL).deps, null), { needed: true, verified: false, local: true, missingRequired: [], integrations: null })
  // Borde: development dentro de Railway no es local.
  const railway = await getSetupStatus(install({ NODE_ENV: "development", RAILWAY_ENVIRONMENT_NAME: "lucaplan-pr-12" }).deps, null)
  assert.equal(railway.local, false)
  assert.deepEqual(railway.missingRequired, ["RESEND_API_KEY", "RESEND_FROM"])
  // Bordes: una clave que ya está, en el entorno o en Ajustes, deja de faltar.
  assert.deepEqual((await getSetupStatus(install({ ...PROD, RESEND_FROM: "Luca Plan <a@b.cl>" }).deps, null)).missingRequired, ["RESEND_API_KEY"])
  assert.deepEqual((await getSetupStatus(install({ ...PROD, RESEND_API_KEY: "" }).deps, null)).missingRequired, ["RESEND_API_KEY", "RESEND_FROM"])
})

test("al arrancar sin cuentas se genera un código de instalación y se imprime una sola vez en la consola; con cuentas no hay código", async (t) => {
  const s = install(PROD)
  const { printed, result } = await silenced(t, async () => [await ensureSetupCode(s.deps), await ensureSetupCode(s.deps)])
  const [first, second] = result
  assert.match(first!, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  assert.equal(second, first, "el segundo arranque del mismo proceso no cambia el código")
  const lines = printed.filter((l) => l.includes(first!))
  assert.equal(lines.length, 1, "se imprime una sola vez")
  assert.match(lines[0], /\[setup\] Código de instalación: [A-Z0-9]{4}-[A-Z0-9]{4}/)
  // Reiniciar el servidor (estado nuevo) da otro código.
  const restarted = install(PROD)
  const { result: other } = await silenced(t, () => ensureSetupCode(restarted.deps))
  assert.notEqual(other, first)
  // Con una cuenta creada no se genera ni se imprime nada.
  const done = install(PROD, 1)
  const { printed: quiet, result: none } = await silenced(t, () => ensureSetupCode(done.deps))
  assert.equal(none, null)
  assert.ok(!quiet.some((l) => l.includes("[setup]")))
})

test("verificar el código correcto habilita el asistente; uno incorrecto responde 401, y pasados 5 intentos fallidos por IP en una hora responde 429", async (t) => {
  const s = install(PROD)
  const { result: code } = await silenced(t, () => ensureSetupCode(s.deps))
  // Correcto, también en minúsculas o sin guion: devuelve el valor de la cookie de setup.
  const token = await verifySetupCode(s.deps, { code: code!.toLowerCase().replace("-", "") }, IP)
  assert.equal(typeof token, "string")
  assert.ok(token.length >= 32, "la cookie no se adivina")
  assert.notEqual(token.replace("-", ""), code!.replace("-", ""))
  assert.equal((await getSetupStatus(s.deps, token)).verified, true)
  assert.equal((await getSetupStatus(s.deps, "otra-cookie-cualquiera")).verified, false)

  // Incorrecto: 401. Mal formado: 422 (no cuenta como intento: lo rechaza el esquema).
  const wrong = code!.startsWith("AAAA") ? "BBBB-BBBB" : "AAAA-AAAA"
  await assert.rejects(verifySetupCode(s.deps, { code: "abc" }, IP), (e) => domainErrorStatus(e) === 422)
  for (let i = 1; i <= 5; i++)
    await assert.rejects(verifySetupCode(s.deps, { code: wrong }, IP), (e) => domainErrorStatus(e) === 401, `intento ${i}`)
  // Borde: el 6.º intento en la hora responde 429, aunque traiga el código correcto.
  await assert.rejects(verifySetupCode(s.deps, { code: code! }, IP), (e) => domainErrorStatus(e) === 429)
  // Otra IP no queda bloqueada.
  assert.equal(typeof (await verifySetupCode(s.deps, { code: code! }, "198.51.100.2")), "string")
  // Borde: un minuto antes de cumplirse la hora del primer fallo sigue bloqueada; cumplida, vuelve a poder.
  s.clock.now = new Date(s.clock.now.getTime() + 59 * 60 * 1000)
  await assert.rejects(verifySetupCode(s.deps, { code: code! }, IP), (e) => domainErrorStatus(e) === 429)
  s.clock.now = new Date(s.clock.now.getTime() + 60 * 1000)
  assert.equal(typeof (await verifySetupCode(s.deps, { code: code! }, IP)), "string")
})

test("con la cookie de setup se guardan las claves cifradas igual que en Ajustes, con las mismas reglas; sin cookie responde 401 y no escribe", async (t) => {
  const s = install(PROD, 0)
  const s2 = install({ ...PROD, RESEND_FROM: "Luca Plan <a@b.cl>" })
  // Sin cookie, o con una que no es de este proceso: 401.
  for (const token of [null, "inventada"])
    await assert.rejects(
      updateSetupIntegrations(s.deps, token, { values: { RESEND_API_KEY: SECRET } }),
      (e) => domainErrorStatus(e) === 401
    )
  assert.deepEqual(s.writes, [])

  const token = await verified(t, s)
  const status = await updateSetupIntegrations(s.deps, token, { values: { RESEND_API_KEY: SECRET, RESEND_FROM: "Luca Plan <a@b.cl>" } })
  const stored = s.rows.get("RESEND_API_KEY")!.value
  assert.ok(!stored.includes(SECRET), "app_setting guarda el texto plano")
  assert.equal(await resolveIntegration(s.deps.integrations, "RESEND_API_KEY"), SECRET)
  assert.equal(status.entries.find((e) => e.key === "RESEND_API_KEY")!.display, "••••1234")
  assert.ok(!JSON.stringify(status).includes(SECRET))
  // Ya no falta nada para entrar.
  assert.deepEqual((await getSetupStatus(s.deps, token)).missingRequired, [])
  // Mismas reglas que Ajustes: 422 si es inválida, 409 si viene del entorno.
  await assert.rejects(updateSetupIntegrations(s.deps, token, { values: { RESEND_API_KEY: "re abc" } }), (e) => domainErrorStatus(e) === 422)
  const token2 = await verified(t, s2)
  await assert.rejects(updateSetupIntegrations(s2.deps, token2, { values: { RESEND_FROM: "x@y.cl" } }), (e) => domainErrorStatus(e) === 409)
  assert.deepEqual(s2.writes, [])
})

test("en cuanto existe una cuenta, todo /api/setup responde 404 y el código ya no sirve, aunque se tenga la cookie", async (t) => {
  const s = install(PROD)
  const { result: code } = await silenced(t, () => ensureSetupCode(s.deps))
  const token = await verifySetupCode(s.deps, { code: code! }, IP)
  s.accounts = 1 // se creó la primera cuenta
  await assert.rejects(getSetupStatus(s.deps, token), (e) => domainErrorStatus(e) === 404)
  await assert.rejects(verifySetupCode(s.deps, { code: code! }, IP), (e) => domainErrorStatus(e) === 404)
  await assert.rejects(
    updateSetupIntegrations(s.deps, token, { values: { RESEND_API_KEY: SECRET } }),
    (e) => domainErrorStatus(e) === 404
  )
  // Borde: ya instalado manda sobre la falta de cookie (no revela nada del asistente).
  await assert.rejects(updateSetupIntegrations(s.deps, null, { values: {} }), (e) => domainErrorStatus(e) === 404)
  assert.deepEqual(s.writes, [])
})

test("30 códigos incorrectos en 10 minutos, aunque vengan de IPs distintas, frenan a todos con 429 sin cambiar el código; la ventana se libera sola", async (t) => {
  const s = install(PROD)
  const { result: code } = await silenced(t, () => ensureSetupCode(s.deps))
  const wrong = code!.startsWith("AAAA") ? "BBBB-BBBB" : "AAAA-AAAA"
  // Una IP distinta por intento: el tope por IP no frena a nadie.
  for (let i = 1; i <= 30; i++)
    await assert.rejects(verifySetupCode(s.deps, { code: wrong }, `198.51.100.${i}`), (e) => domainErrorStatus(e) === 401, `intento ${i}`)
  // Lleno: ni el código correcto pasa, desde ninguna IP.
  await assert.rejects(verifySetupCode(s.deps, { code: code! }, "198.51.100.200"), (e) => domainErrorStatus(e) === 429)
  // A los 10 minutos se libera y el mismo código de la consola sigue sirviendo.
  s.clock.now = new Date(s.clock.now.getTime() + 10 * 60 * 1000)
  assert.equal(typeof (await verifySetupCode(s.deps, { code: code! }, "198.51.100.201")), "string")
  // Borde: 29 incorrectos no frenan.
  const s29 = install(PROD)
  const { result: c29 } = await silenced(t, () => ensureSetupCode(s29.deps))
  const w29 = c29!.startsWith("AAAA") ? "BBBB-BBBB" : "AAAA-AAAA"
  for (let i = 1; i <= 29; i++) await verifySetupCode(s29.deps, { code: w29 }, `203.0.113.${i}`).catch(() => {})
  assert.equal(typeof (await verifySetupCode(s29.deps, { code: c29! }, "203.0.113.50")), "string")
})
