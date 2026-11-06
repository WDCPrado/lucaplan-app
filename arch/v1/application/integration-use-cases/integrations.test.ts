// Claves de terceros en Ajustes → Integraciones (WDC-181): ver, cambiar y resolver. Solo ADMIN.
// Repo en memoria (la tabla app_setting) y el cifrado real de la instalación.
// Corre con: node --test arch/v1/application/integration-use-cases/integrations.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { getIntegrations } from "./get-integrations-use-case.ts"
import { updateIntegrations } from "./update-integrations-use-case.ts"
import { resolveIntegration } from "./resolve-integration-use-case.ts"
import { getOnboardingStatus } from "../onboarding-use-cases/get-onboarding-status-use-case.ts"
import { openaiConfig, openaiConfigured } from "../../infrastructure/http/ai/openai-config.ts"
import { integrationCipher } from "../../infrastructure/crypto/integration-cipher.ts"
import { domainErrorStatus } from "../domain-error-status.ts"
import {
  INTEGRATION_KEYS,
  integrationsStatus,
  type IntegrationKey,
  type IntegrationsStatus,
} from "../../../../lib/integration-settings-schemas.ts"
import type {
  IntegrationDeps,
  IntegrationSettingsRepository,
  StoredIntegration,
} from "../../domain/integrations/integrations.domain.ts"
import type { Actor } from "../../domain/authorization/authorization.domain.ts"

// Llave maestra de prueba: así el cifrado real no escribe .bancochile-key en el repo.
const MASTER = "wdc181-llave-maestra-de-prueba-0123456789abcdef"
process.env.BANCOCHILE_ENC_KEY = MASTER

const admin: Actor = { userId: "admin1", role: "ADMIN" }
const user: Actor = { userId: "user1", role: "USER" }
const premium: Actor = { userId: "prem1", role: "PREMIUM" }

const SECRET = "sk-proj-Zq81VeryLongSecretValueabcd"

// app_setting en memoria: guarda `value` tal cual lo manda el caso de uso (cifrado si es secreto).
function store(initial: StoredIntegration[] = []) {
  const rows = new Map(initial.map((r) => [r.key, { ...r }]))
  const writes: string[] = []
  let reads = 0
  const settings: IntegrationSettingsRepository = {
    async list() {
      reads++
      return [...rows.values()].map((r) => ({ ...r }))
    },
    async save(key, value) {
      writes.push(`save:${key}`)
      rows.set(key, { key, value, updatedAt: new Date() })
    },
    async remove(key) {
      writes.push(`remove:${key}`)
      rows.delete(key)
    },
  }
  return { rows, writes, settings, reads: () => reads }
}

function deps(
  s: ReturnType<typeof store>,
  env: Record<string, string | undefined> = {}
): IntegrationDeps {
  return { settings: s.settings, cipher: integrationCipher, env, cache: new Map() }
}

const entry = (status: IntegrationsStatus, key: IntegrationKey) => {
  const e = status.entries.find((x) => x.key === key)
  assert.ok(e, `falta ${key}`)
  return e!
}

// Todo lo que el servidor imprime durante `fn`.
async function captureConsole<T>(t: { mock: typeof test.mock }, fn: () => Promise<T>) {
  const printed: string[] = []
  for (const m of ["log", "info", "warn", "error", "debug"] as const)
    t.mock.method(console, m, (...args: unknown[]) => {
      printed.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
    })
  const result = await fn()
  return { printed, result }
}

// --- Ver ---------------------------------------------------------------------------------------

test("ADMIN ve las 7 claves, cada una con su origen: entorno, Ajustes o nada; con la variable de entorno puesta manda el entorno", async () => {
  const s = store()
  // Se guardó en Ajustes cuando aún no estaba la variable; después se puso en el entorno.
  await updateIntegrations(deps(s), admin, { values: { OUTLOOK_CLIENT_ID: "app-123", OPENAI_MODEL: "gpt-x" } })
  const d = deps(s, { OPENAI_MODEL: "gpt-4.1", OUTLOOK_TENANT: "" }) // vacía no cuenta como entorno
  const status = await getIntegrations(d, admin)
  integrationsStatus.parse(status)
  assert.deepEqual(status.entries.map((e) => e.key).sort(), Object.keys(INTEGRATION_KEYS).sort())
  assert.equal(status.entries.length, 7)
  // Entorno: manda aunque haya algo guardado en Ajustes, y no tiene fecha.
  assert.deepEqual(entry(status, "OPENAI_MODEL"), {
    key: "OPENAI_MODEL",
    source: "env",
    display: "gpt-4.1",
    updatedAt: null,
  })
  // Ajustes: con la fecha ISO del guardado.
  const outlook = entry(status, "OUTLOOK_CLIENT_ID")
  assert.equal(outlook.source, "app")
  assert.equal(outlook.display, "app-123")
  assert.ok(outlook.updatedAt && !Number.isNaN(Date.parse(outlook.updatedAt)))
  // Nada: ni entorno (la variable vacía no cuenta) ni Ajustes.
  assert.deepEqual(entry(status, "OUTLOOK_TENANT"), {
    key: "OUTLOOK_TENANT",
    source: "none",
    display: null,
    updatedAt: null,
  })
})

test("un secreto se muestra «••••» con sus últimos 4 caracteres y nunca completo; un valor que no es secreto se muestra entero", async () => {
  const s = store()
  const d = deps(s, { RESEND_API_KEY: "re_EnvSecret9876" })
  await updateIntegrations(d, admin, {
    values: { OPENAI_API_KEY: SECRET, RESEND_FROM: "hola@lucaplan.cl", OUTLOOK_CLIENT_SECRET: "Q7z" },
  })
  const status = await getIntegrations(d, admin)
  assert.equal(entry(status, "OPENAI_API_KEY").display, "••••abcd")
  // El secreto que viene del entorno también va enmascarado.
  assert.equal(entry(status, "RESEND_API_KEY").display, "••••9876")
  // No secreto: entero.
  assert.equal(entry(status, "RESEND_FROM").display, "hola@lucaplan.cl")
  // Borde: un secreto de 4 caracteres o menos no se revela; solo «••••».
  assert.equal(entry(status, "OUTLOOK_CLIENT_SECRET").display, "••••")
  // En ninguna parte de la respuesta aparece un secreto completo.
  const json = JSON.stringify(status)
  for (const secret of [SECRET, "re_EnvSecret9876", "Q7z"]) assert.ok(!json.includes(secret), secret)
  // Tampoco la respuesta de guardar.
  const saved = await updateIntegrations(d, admin, { values: { OPENAI_API_KEY: SECRET } })
  assert.ok(!JSON.stringify(saved).includes(SECRET))
})

test("solo ADMIN ve o cambia las integraciones: USER y PREMIUM reciben 403 y sin sesión 401, sin leer ni escribir nada", async () => {
  const s = store()
  const d = deps(s)
  for (const [actor, status] of [
    [user, 403],
    [premium, 403],
    [null, 401],
  ] as const) {
    await assert.rejects(getIntegrations(d, actor), (e) => domainErrorStatus(e) === status, `GET ${actor?.role}`)
    await assert.rejects(
      updateIntegrations(d, actor, { values: { OPENAI_API_KEY: SECRET } }),
      (e) => domainErrorStatus(e) === status,
      `PUT ${actor?.role}`
    )
    // Borde: el permiso se mira antes que la entrada; un cuerpo inválido de USER sigue siendo 403.
    await assert.rejects(
      updateIntegrations(d, actor, { values: { NO_EXISTE: "x" } }),
      (e) => domainErrorStatus(e) === status
    )
  }
  assert.deepEqual(s.writes, [])
  assert.equal(s.reads(), 0)
})

// --- Cambiar -----------------------------------------------------------------------------------

test("ADMIN guarda OPENAI_API_KEY: queda cifrada en app_setting y la resolución la devuelve en el siguiente uso, sin reiniciar", async () => {
  const s = store()
  const d = deps(s)
  assert.equal(await resolveIntegration(d, "OPENAI_API_KEY"), null)
  // Caché: el segundo uso no vuelve a leer la base.
  const before = s.reads()
  assert.equal(await resolveIntegration(d, "OPENAI_API_KEY"), null)
  assert.equal(s.reads(), before)

  await updateIntegrations(d, admin, { values: { OPENAI_API_KEY: SECRET } })
  const stored = s.rows.get("OPENAI_API_KEY")!.value
  assert.ok(!stored.includes(SECRET), "app_setting guarda el texto plano")
  assert.ok(!stored.includes("abcd"))
  // Mismas deps (mismo proceso): guardar invalida la caché.
  assert.equal(await resolveIntegration(d, "OPENAI_API_KEY"), SECRET)
  // Cambiarla otra vez también rige al tiro.
  await updateIntegrations(d, admin, { values: { OPENAI_API_KEY: "sk-otra-clave-9999" } })
  assert.equal(await resolveIntegration(d, "OPENAI_API_KEY"), "sk-otra-clave-9999")
})

test("guardar null borra la clave de Ajustes: queda sin configurar y la resolución deja de devolverla", async () => {
  const s = store()
  const d = deps(s)
  await updateIntegrations(d, admin, { values: { OPENAI_API_KEY: SECRET, OPENAI_MODEL: "gpt-x" } })
  assert.equal(await resolveIntegration(d, "OPENAI_API_KEY"), SECRET)
  const status = await updateIntegrations(d, admin, { values: { OPENAI_API_KEY: null } })
  assert.deepEqual(entry(status, "OPENAI_API_KEY"), {
    key: "OPENAI_API_KEY",
    source: "none",
    display: null,
    updatedAt: null,
  })
  assert.equal(s.rows.has("OPENAI_API_KEY"), false)
  assert.equal(await resolveIntegration(d, "OPENAI_API_KEY"), null)
  // Solo cambia lo que viene en la entrada.
  assert.equal(await resolveIntegration(d, "OPENAI_MODEL"), "gpt-x")
  // Borde: borrar una clave que no estaba guardada no falla.
  await updateIntegrations(d, admin, { values: { RESEND_API_KEY: null } })
})

test("una clave que viene del entorno no se puede cambiar ni borrar desde Ajustes: 409 y no escribe nada, tampoco las otras del mismo envío", async () => {
  const s = store()
  const d = deps(s, { OPENAI_API_KEY: "sk-env-1234" })
  for (const value of ["sk-nueva-5678", null]) {
    await assert.rejects(
      updateIntegrations(d, admin, { values: { OPENAI_MODEL: "gpt-x", OPENAI_API_KEY: value } }),
      (e) => domainErrorStatus(e) === 409
    )
  }
  assert.deepEqual(s.writes, [])
  assert.equal(await resolveIntegration(d, "OPENAI_API_KEY"), "sk-env-1234")
  // Borde: con la variable vacía no viene del entorno y sí se puede guardar.
  const d2 = deps(s, { OPENAI_API_KEY: "" })
  await updateIntegrations(d2, admin, { values: { OPENAI_API_KEY: "sk-nueva-5678" } })
  assert.deepEqual(s.writes, ["save:OPENAI_API_KEY"])
})

test("una clave desconocida, un valor vacío, una clave con espacios o de más de 500 caracteres responden 422 y no escriben nada; solo el remitente de Resend admite espacios", async () => {
  const s = store()
  const d = deps(s)
  for (const values of [
    { NO_EXISTE: "x" },
    { OPENAI_API_KEY: "" },
    { OPENAI_API_KEY: "   " },
    { OPENAI_API_KEY: "sk abc" }, // secreto con espacios
    { RESEND_API_KEY: "re_abc 123" },
    { OUTLOOK_CLIENT_SECRET: "entra\tsecret" },
    { OUTLOOK_TENANT: "mi tenant" }, // no secreto, pero tampoco lleva espacios
    { RESEND_FROM: "Luca Plan <a@b.cl>", RESEND_API_KEY: "re_abc 123" }, // el remitente bueno no salva al secreto malo
    { OPENAI_API_KEY: "x".repeat(501) },
    { OPENAI_MODEL: "gpt-x", RESEND_FROM: "" }, // una mala tumba el envío entero
  ]) {
    await assert.rejects(
      updateIntegrations(d, admin, { values }),
      (e) => domainErrorStatus(e) === 422,
      JSON.stringify(values).slice(0, 60)
    )
  }
  assert.deepEqual(s.writes, [])
  // Bordes válidos: 500 caracteres justos, y los espacios de los extremos se recortan.
  await updateIntegrations(d, admin, { values: { OPENAI_API_KEY: "x".repeat(500), OPENAI_MODEL: "  gpt-x  " } })
  assert.equal(await resolveIntegration(d, "OPENAI_API_KEY"), "x".repeat(500))
  assert.equal(await resolveIntegration(d, "OPENAI_MODEL"), "gpt-x")
  // Borde: el remitente de Resend sí admite espacios («Nombre <correo>»), y se guarda tal cual.
  await updateIntegrations(d, admin, { values: { RESEND_FROM: "Luca Plan <a@b.cl>" } })
  assert.equal(await resolveIntegration(d, "RESEND_FROM"), "Luca Plan <a@b.cl>")
  // Pero tampoco puede quedar vacío ni pasar de 500.
  for (const RESEND_FROM of ["   ", "a".repeat(501)])
    await assert.rejects(updateIntegrations(d, admin, { values: { RESEND_FROM } }), (e) => domainErrorStatus(e) === 422)
})

test("cambiar o borrar una clave deja en el log del servidor cuál y quién la cambió, nunca el valor", async (t) => {
  const s = store()
  const d = deps(s)
  const { printed } = await captureConsole(t, async () => {
    await updateIntegrations(d, admin, { values: { OPENAI_API_KEY: SECRET, OUTLOOK_TENANT: "consumers" } })
    await updateIntegrations(d, admin, { values: { OPENAI_API_KEY: null } })
  })
  const lines = printed.filter((l) => l.includes("OPENAI_API_KEY"))
  assert.ok(lines.length >= 2, "falta el log del cambio y del borrado")
  assert.ok(lines.every((l) => l.includes("admin1")), "el log no dice quién")
  assert.ok(printed.some((l) => l.includes("OUTLOOK_TENANT") && l.includes("admin1")))
  const all = printed.join("\n")
  assert.ok(!all.includes(SECRET) && !all.includes("abcd"), "el log trae el secreto")
  assert.ok(!all.includes("consumers"), "el log trae el valor")
})

// --- Resolver ----------------------------------------------------------------------------------

test("la resolución sigue el orden entorno, luego Ajustes, luego nada", async () => {
  const s = store()
  await updateIntegrations(deps(s), admin, { values: { OPENAI_API_KEY: SECRET } })
  // Entorno no vacío: manda sobre Ajustes.
  assert.equal(await resolveIntegration(deps(s, { OPENAI_API_KEY: "sk-env-1234" }), "OPENAI_API_KEY"), "sk-env-1234")
  // Borde: variable vacía o ausente → Ajustes.
  assert.equal(await resolveIntegration(deps(s, { OPENAI_API_KEY: "" }), "OPENAI_API_KEY"), SECRET)
  assert.equal(await resolveIntegration(deps(s, {}), "OPENAI_API_KEY"), SECRET)
  // Ni entorno ni Ajustes → null.
  assert.equal(await resolveIntegration(deps(s, {}), "RESEND_API_KEY"), null)
  // El entorno se mira en cada uso: no queda pegado en la caché.
  const env: Record<string, string | undefined> = {}
  const d = deps(s, env)
  assert.equal(await resolveIntegration(d, "OPENAI_API_KEY"), SECRET)
  env.OPENAI_API_KEY = "sk-env-1234"
  assert.equal(await resolveIntegration(d, "OPENAI_API_KEY"), "sk-env-1234")
})

test("con las claves en Ajustes y sin variables de entorno, la IA y Outlook quedan disponibles", async () => {
  const s = store()
  const d = deps(s)
  const onboarding = { async completedAt() { return null }, async markCompleted() {} }
  assert.equal(await openaiConfigured(d), false)
  let status = await getOnboardingStatus({ onboarding, integrations: d }, "u1")
  assert.equal(status.aiAvailable, false)
  assert.equal(status.outlookAvailable, false)

  await updateIntegrations(d, admin, {
    values: { OPENAI_API_KEY: SECRET, OPENAI_MODEL: "gpt-4.1-mini", OUTLOOK_CLIENT_ID: "app-123" },
  })
  assert.equal(await openaiConfigured(d), true)
  const cfg = await openaiConfig(d)
  assert.equal(cfg.apiKey, SECRET)
  assert.equal(cfg.model, "gpt-4.1-mini")
  status = await getOnboardingStatus({ onboarding, integrations: d }, "u1")
  assert.equal(status.aiAvailable, true)
  // Borde: Outlook necesita client id y client secret; con uno solo sigue no disponible.
  assert.equal(status.outlookAvailable, false)
  await updateIntegrations(d, admin, { values: { OUTLOOK_CLIENT_SECRET: "entra-secret-0001" } })
  status = await getOnboardingStatus({ onboarding, integrations: d }, "u1")
  assert.equal(status.outlookAvailable, true)
})

test("si un secreto guardado no se puede descifrar (cambió la llave maestra), queda como no configurado y se registra un aviso, sin romper la app", async (t) => {
  const s = store()
  await updateIntegrations(deps(s), admin, { values: { OPENAI_API_KEY: SECRET, OPENAI_MODEL: "gpt-x" } })
  process.env.BANCOCHILE_ENC_KEY = "otra-llave-maestra-distinta-0123456789abcdef"
  try {
    const d = deps(s)
    const { printed, result } = await captureConsole(t, async () => ({
      key: await resolveIntegration(d, "OPENAI_API_KEY"),
      configured: await openaiConfigured(d),
      status: await getIntegrations(d, admin),
    }))
    assert.equal(result.key, null)
    assert.equal(result.configured, false)
    assert.equal(entry(result.status, "OPENAI_API_KEY").source, "none")
    assert.equal(entry(result.status, "OPENAI_API_KEY").display, null)
    assert.ok(printed.some((l) => l.includes("OPENAI_API_KEY")), "falta el aviso")
    assert.ok(!printed.join("\n").includes(SECRET))
    // Guardarla de nuevo con la llave nueva la repara.
    await updateIntegrations(d, admin, { values: { OPENAI_API_KEY: SECRET } })
    assert.equal(await resolveIntegration(d, "OPENAI_API_KEY"), SECRET)
  } finally {
    process.env.BANCOCHILE_ENC_KEY = MASTER
  }
})
