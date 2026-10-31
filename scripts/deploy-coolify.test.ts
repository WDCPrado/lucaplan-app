import { test } from "node:test"
import assert from "node:assert/strict"
import { deployCoolify } from "./deploy-coolify.mjs"

const sha = "a".repeat(40)
const options = { url: "https://coolify.example.com", token: "secret-token", uuid: "app-123", sha,
  databaseUuid: "db-123", backupUuid: "backup-123" }
const app = { git_commit_sha: sha, git_branch: "master", build_pack: "dockerfile" }
const healthy = { ...app, status: "running:healthy" }
const backup = { uuid: "execution-1", filename: "backup.dump", size: 123, status: "success" }
const backedUp = () => [{ executions: [] }, {}, { executions: [backup] }]

function responses(values: unknown[]) {
  const calls: { url: URL; method: string; body?: string }[] = []
  const request: typeof fetch = async (url, init) => {
    assert.ok(url instanceof URL)
    assert.ok(init && typeof init.method === "string")
    assert.ok(init.body === undefined || typeof init.body === "string")
    calls.push({ url, method: init.method, body: init.body })
    const value = values.shift()
    assert.notEqual(value, undefined, "Petición inesperada")
    return value instanceof Response ? value : Response.json(value)
  }
  return { request, calls }
}

test("fija el SHA y desactiva despliegues independientes antes de encolar; espera finalización", async () => {
  const mock = responses([{}, app, ...backedUp(), { deployments: [{ deployment_uuid: "deploy-1" }] },
    { commit: sha, status: "queued" }, { commit: sha, status: "in_progress" }, { commit: sha, status: "finished" }, healthy])
  let waits = 0
  const result = await deployCoolify({ ...options, request: mock.request, wait: async () => { waits++ } })
  assert.deepEqual(result, { deployment: "deploy-1", sha })
  assert.deepEqual(JSON.parse(mock.calls[0].body!), {
    git_commit_sha: sha, is_auto_deploy_enabled: false, is_preview_deployments_enabled: false, health_check_enabled: false,
  })
  assert.equal(mock.calls[0].method, "PATCH")
  assert.equal(mock.calls[0].url.pathname, "/api/v1/applications/app-123")
  assert.equal(mock.calls[3].method, "PATCH")
  assert.equal(mock.calls[3].url.pathname, "/api/v1/databases/db-123/backups/backup-123")
  assert.deepEqual(JSON.parse(mock.calls[3].body!), { backup_now: true })
  assert.equal(mock.calls[5].method, "POST")
  assert.equal(mock.calls[5].url.pathname, "/api/v1/deploy")
  assert.deepEqual(JSON.parse(mock.calls[5].body!), { uuid: "app-123" })
  assert.equal(waits, 2)
})

test("rechaza configuración insegura antes de enviar el token", async () => {
  for (const change of [{ sha: "HEAD" }, { url: "http://coolify.example.com" },
    { url: "https://user:pass@coolify.example.com" }, { url: "https://coolify.example.com/api/v1" }, { uuid: "../other" }, { token: "" }, { databaseUuid: "" }, { backupUuid: "../other" }]) {
    const mock = responses([])
    await assert.rejects(deployCoolify({ ...options, ...change, request: mock.request }))
    assert.equal(mock.calls.length, 0)
  }
})

test("no encola si Coolify no confirma el commit o el recurso correcto", async () => {
  for (const change of [{ git_commit_sha: "HEAD" }, { git_branch: "feature/test" }, { build_pack: "dockerimage" }]) {
    const mock = responses([{}, { ...app, ...change }])
    await assert.rejects(deployCoolify({ ...options, request: mock.request }), /no confirmó/)
    assert.equal(mock.calls.length, 2)
  }
})

test("errores HTTP no exponen cuerpos con secretos ni solicitan despliegue", async () => {
  const mock = responses([new Response("secret-token DATABASE_URL=private", { status: 500 })])
  await assert.rejects(deployCoolify({ ...options, request: mock.request }), { message: "Coolify PATCH: HTTP 500." })
  assert.equal(mock.calls.length, 1)
})

test("fallos, SHA distinto y timeout no se reportan como éxito", async () => {
  for (const state of [{ commit: sha, status: "failed" }, { commit: sha, status: "cancelled-by-user" },
    { commit: "b".repeat(40), status: "finished" }, { commit: sha, status: "in_progress" }]) {
    const mock = responses([{}, app, ...backedUp(), { deployments: [{ deployment_uuid: "deploy-1" }] }, state])
    await assert.rejects(deployCoolify({ ...options, request: mock.request, attempts: 1, wait: async () => {} }))
  }
})

test("rechaza un deploy sin identificador y respuestas inválidas", async () => {
  const mock = responses([{}, app, ...backedUp(), {}])
  await assert.rejects(deployCoolify({ ...options, request: mock.request }), /ID de despliegue/)
  const invalid = responses([new Response("not-json")])
  await assert.rejects(deployCoolify({ ...options, request: invalid.request }), /respuesta inválida/)
})

test("backup anterior, fallido, ambiguo o ausente impide desplegar", async () => {
  for (const entries of [[backup], [{ ...backup, uuid: "new", status: "failed" }],
    [{ ...backup, uuid: "new", size: 0 }], [{ ...backup, uuid: "new" }, { ...backup, uuid: "other" }], []]) {
    const mock = responses([{}, app, { executions: [backup] }, {}, { executions: entries }])
    await assert.rejects(deployCoolify({ ...options, request: mock.request, backupAttempts: 1, wait: async () => {} }))
    assert.equal(mock.calls.some((call) => call.url.pathname === "/api/v1/deploy"), false)
  }
})

test("espera un backup nuevo y no confunde el éxito anterior con el solicitado", async () => {
  const old = { ...backup, uuid: "old" }
  const mock = responses([{}, app, { executions: [old] }, {}, { executions: [old] },
    { executions: [old, { ...backup, status: "running" }] }, { executions: [old, backup] },
    { deployments: [{ deployment_uuid: "deploy-1" }] }, { commit: sha, status: "finished" }, healthy])
  let waits = 0
  await deployCoolify({ ...options, request: mock.request, wait: async () => { waits++ } })
  assert.equal(waits, 2)
})

test("backup activo o historial inválido aborta antes de disparar otro", async () => {
  for (const history of [{ executions: [{ ...backup, status: "running" }] }, {}, { executions: [{}] }]) {
    const mock = responses([{}, app, history])
    await assert.rejects(deployCoolify({ ...options, request: mock.request }))
    assert.equal(mock.calls.length, 3)
  }
})

test("finished no basta: espera salud real y falla si vence o cambia el SHA", async () => {
  const prefix = () => [{}, app, ...backedUp(), { deployments: [{ deployment_uuid: "deploy-1" }] }, { commit: sha, status: "finished" }]
  const mock = responses([...prefix(), { ...app, status: "running:starting" }, healthy])
  let waits = 0
  await deployCoolify({ ...options, request: mock.request, wait: async () => { waits++ } })
  assert.equal(waits, 1)
  for (const state of [{ ...app, status: "running:unhealthy" }, { ...app, status: "exited" },
    { ...healthy, git_commit_sha: "b".repeat(40) }]) {
    const failed = responses([...prefix(), state])
    await assert.rejects(deployCoolify({ ...options, request: failed.request, healthAttempts: 1, wait: async () => {} }))
  }
})
