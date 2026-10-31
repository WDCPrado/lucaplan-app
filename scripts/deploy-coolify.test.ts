import { test } from "node:test"
import assert from "node:assert/strict"
import { deployCoolify } from "./deploy-coolify.mjs"

const sha = "a".repeat(40)
const options = { url: "https://coolify.example.com", token: "secret-token", uuid: "app-123", sha }
const app = { git_commit_sha: sha, git_branch: "master", build_pack: "dockercompose" }

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
  const mock = responses([{}, app, { deployments: [{ deployment_uuid: "deploy-1" }] },
    { commit: sha, status: "queued" }, { commit: sha, status: "in_progress" }, { commit: sha, status: "finished" }])
  let waits = 0
  const result = await deployCoolify({ ...options, request: mock.request, wait: async () => { waits++ } })
  assert.deepEqual(result, { deployment: "deploy-1", sha })
  assert.deepEqual(JSON.parse(mock.calls[0].body!), {
    git_commit_sha: sha, is_auto_deploy_enabled: false, is_preview_deployments_enabled: false,
  })
  assert.equal(mock.calls[0].method, "PATCH")
  assert.equal(mock.calls[0].url.pathname, "/api/v1/applications/app-123")
  assert.equal(mock.calls[2].method, "POST")
  assert.equal(mock.calls[2].url.pathname, "/api/v1/deploy")
  assert.deepEqual(JSON.parse(mock.calls[2].body!), { uuid: "app-123" })
  assert.equal(waits, 2)
})

test("rechaza configuración insegura antes de enviar el token", async () => {
  for (const change of [{ sha: "HEAD" }, { url: "http://coolify.example.com" },
    { url: "https://user:pass@coolify.example.com" }, { url: "https://coolify.example.com/api/v1" }, { uuid: "../other" }, { token: "" }]) {
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
    const mock = responses([{}, app, { deployments: [{ deployment_uuid: "deploy-1" }] }, state])
    await assert.rejects(deployCoolify({ ...options, request: mock.request, attempts: 1, wait: async () => {} }))
  }
})

test("rechaza un deploy sin identificador y respuestas inválidas", async () => {
  const mock = responses([{}, app, {}])
  await assert.rejects(deployCoolify({ ...options, request: mock.request }), /ID de despliegue/)
  const invalid = responses([new Response("not-json")])
  await assert.rejects(deployCoolify({ ...options, request: invalid.request }), /respuesta inválida/)
})
