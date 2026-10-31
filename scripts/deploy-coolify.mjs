import { setTimeout } from "node:timers/promises"

// Coolify fija git_commit_sha en la entrada de la cola: no despliega el HEAD que cambie después.
export async function deployCoolify({
  url, token, uuid, sha, request = fetch, wait = (ms) => setTimeout(ms), attempts = 210,
}) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("Falta el SHA completo validado.")
  if (!token || !/^[a-zA-Z0-9-]+$/.test(uuid ?? "")) throw new Error("Configura COOLIFY_TOKEN y COOLIFY_APP_UUID.")
  let base
  try { base = new URL(url) } catch { throw new Error("Configura COOLIFY_URL con el origen HTTPS de Coolify.") }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new Error("COOLIFY_URL debe ser un origen HTTPS sin credenciales, ruta ni query.")
  }
  async function api(path, method = "GET", body) {
    let response
    try {
      response = await request(new URL(`/api/v1${path}`, base), {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      })
    } catch { throw new Error(`Coolify ${method}: conexión fallida; revisa el panel antes de reintentar.`) }
    // No imprimir cuerpos ni errores del servidor: pueden incluir variables de producción.
    if (!response.ok) throw new Error(`Coolify ${method}: HTTP ${response.status}.`)
    try { return await response.json() } catch { throw new Error("Coolify devolvió una respuesta inválida.") }
  }
  await api(`/applications/${uuid}`, "PATCH", {
    git_commit_sha: sha,
    is_auto_deploy_enabled: false,
    is_preview_deployments_enabled: false,
  })
  const app = await api(`/applications/${uuid}`)
  if (app.git_commit_sha !== sha || app.git_branch !== "master" || app.build_pack !== "dockercompose") {
    throw new Error("Coolify no confirmó el SHA, master y Docker Compose; no se solicita despliegue.")
  }
  const result = await api("/deploy", "POST", { uuid })
  const deployment = result.deployments?.[0]?.deployment_uuid
  if (!/^[a-zA-Z0-9-]+$/.test(deployment ?? "")) throw new Error("Coolify no devolvió un ID de despliegue; revisa el panel.")
  console.log(`Coolify: despliegue ${deployment}, commit ${sha}.`)
  for (let attempt = 0; attempt < attempts; attempt++) {
    const state = await api(`/deployments/${deployment}`)
    if (state.commit !== sha) throw new Error("El despliegue no corresponde al SHA validado; revisa Coolify inmediatamente.")
    if (state.status === "finished") {
      console.log(`Coolify terminó el despliegue ${deployment} de ${sha}.`)
      return { deployment, sha }
    }
    if (!["queued", "in_progress"].includes(state.status)) throw new Error("El despliegue no terminó correctamente; revisa Coolify y la guía de recuperación.")
    await wait(10_000)
  }
  throw new Error("Se agotó la espera; el despliegue puede seguir activo en Coolify. Revisa antes de reintentar.")
}

if (import.meta.main) {
  try {
    await deployCoolify({
      url: process.env.COOLIFY_URL,
      token: process.env.COOLIFY_TOKEN,
      uuid: process.env.COOLIFY_APP_UUID,
      sha: process.env.GITHUB_SHA,
    })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
