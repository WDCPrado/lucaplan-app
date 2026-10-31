import { setTimeout } from "node:timers/promises"

// Coolify fija git_commit_sha en la entrada de la cola: no despliega el HEAD que cambie después.
export async function deployCoolify({
  url, token, uuid, sha, databaseUuid, backupUuid,
  request = fetch, wait = (ms) => setTimeout(ms), attempts = 210, backupAttempts = 60,
}) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("Falta el SHA completo validado.")
  if (!token || !/^[a-zA-Z0-9-]+$/.test(uuid ?? "")) throw new Error("Configura COOLIFY_TOKEN y COOLIFY_APP_UUID.")
  if (![databaseUuid, backupUuid].every((id) => /^[a-zA-Z0-9-]+$/.test(id ?? ""))) {
    throw new Error("Configura COOLIFY_DATABASE_UUID y COOLIFY_BACKUP_UUID.")
  }
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
  if (app.git_commit_sha !== sha || app.git_branch !== "master" || app.build_pack !== "dockerfile") {
    throw new Error("Coolify no confirmó el SHA, master y Dockerfile; no se solicita despliegue.")
  }
  const backupPath = `/databases/${databaseUuid}/backups/${backupUuid}`
  async function executions() {
    const result = await api(`${backupPath}/executions`)
    if (!Array.isArray(result.executions) || result.executions.some((item) => !item?.uuid)) {
      throw new Error("Coolify no devolvió un historial de backups válido.")
    }
    return result.executions
  }
  const previous = await executions()
  if (previous.some((item) => !["success", "failed"].includes(item.status))) {
    throw new Error("Ya hay un backup activo; no se solicita despliegue.")
  }
  const previousIds = new Set(previous.map((item) => item.uuid))
  await api(backupPath, "PATCH", { backup_now: true })
  let backedUp = false
  for (let attempt = 0; attempt < backupAttempts; attempt++) {
    const fresh = (await executions()).filter((item) => !previousIds.has(item.uuid))
    // La API no entrega execution UUID: este schedule manual debe ser exclusivo de CI.
    if (fresh.length > 1) throw new Error("Backups concurrentes ambiguos; no se solicita despliegue.")
    if (fresh.length === 1) {
      const backup = fresh[0]
      if (backup.status === "success" && backup.size > 0 && backup.filename) {
        backedUp = true
        break
      }
      if (backup.status !== "running") throw new Error("El backup no terminó correctamente; no se solicita despliegue.")
    }
    await wait(10_000)
  }
  if (!backedUp) throw new Error("Se agotó la espera del backup; no se solicita despliegue.")
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
      databaseUuid: process.env.COOLIFY_DATABASE_UUID,
      backupUuid: process.env.COOLIFY_BACKUP_UUID,
      sha: process.env.GITHUB_SHA,
    })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
