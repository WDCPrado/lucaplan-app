import { execFileSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { resolve, join } from "node:path"

const services = ["app", "cron"]
const shaPattern = /^[a-f0-9]{40}$/

export function affectedServices(paths) {
  const affected = new Set()
  for (const path of paths) {
    if (path === "compose.production.yml") {
      throw new Error("Cambió compose.production.yml: sincroniza y revisa compose.json externo antes de continuar; consulta docs/self-hosting.md.")
    }
    if (/^(docs\/|openspec\/|\.github\/|\.agents\/|\.claude\/)/.test(path) ||
        /(^|\/)(AGENTS|CLAUDE|README)\.md$/.test(path) ||
        /\.test\.[cm]?[jt]sx?$/.test(path) ||
        /^(LICENSE|linear\.json|skills-lock\.json|scripts\/deploy-local\.(mjs|test\.ts))$/.test(path)) continue
    if (/^scripts\/(local-cron\.mjs|sync-email\.ts|notify-due\.ts)$/.test(path)) {
      affected.add("cron")
    } else if (/^(app\/|components\/|hooks\/|public\/)/.test(path) || /^(next|postcss)\.config\./.test(path)) {
      affected.add("app")
    } else {
      // shortcut: rutas desconocidas actualizan ambos; afinar solo con una dependencia comprobada.
      services.forEach((service) => affected.add(service))
    }
  }
  return services.filter((service) => affected.has(service))
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...options })?.trim() ?? ""
  } catch {
    // Compose puede incluir valores runtime en sus errores; no publicarlos en Actions.
    throw new Error(`Falló ${command} ${args[0] ?? ""}; revisa el estado local. No se confirmó el despliegue.`)
  }
}

function writeJson(path, value) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
}

export function deploy({ sha, runtimeDir, cwd = process.cwd(), execute = run }) {
  if (!shaPattern.test(sha ?? "")) throw new Error("Se requiere el SHA completo validado de master.")
  if (!runtimeDir) throw new Error("Define LUCA_RUNTIME_DIR con la carpeta externa de producción.")
  runtimeDir = resolve(runtimeDir)
  const statePath = join(runtimeDir, "deploy-state.json")
  const imagesPath = join(runtimeDir, "deploy-images.json")
  const candidatePath = join(runtimeDir, "deploy-candidate.json")
  const lockPath = join(runtimeDir, "deploy.lock")
  const git = (...args) => execute("git", args, { cwd })
  const composeArgs = ["compose", "-p", "lucaplan-production", "--env-file", join(runtimeDir, "production.env"), "-f", join(runtimeDir, "compose.json")]
  const compose = (args, override) => execute("docker", [...composeArgs, ...(override ? ["-f", override] : []), ...args], { cwd })
  const master = git("ls-remote", "origin", "refs/heads/master").split(/\s/)[0]
  if (sha !== master) {
    console.log("Se omite un SHA anterior a master; la ejecución más reciente desplegará los cambios pendientes.")
    return { skipped: true }
  }
  if (git("rev-parse", "HEAD") !== sha || git("status", "--porcelain")) throw new Error("El checkout debe estar limpio y en el SHA validado.")
  let lock
  try { lock = openSync(lockPath, "wx") } catch { throw new Error("Existe deploy.lock: hay un despliegue activo o interrumpido; revisa antes de reintentar.") }
  try {
    writeFileSync(lock, JSON.stringify({ sha, pid: process.pid, startedAt: new Date().toISOString() }))
    compose(["config", "--quiet"])
    let state
    if (existsSync(statePath)) {
      state = JSON.parse(readFileSync(statePath, "utf8"))
    } else {
      const previous = JSON.parse(readFileSync(join(runtimeDir, "last-deploy.json"), "utf8"))
      if (!shaPattern.test(previous.commit ?? "") || !previous.image) throw new Error("last-deploy.json no tiene commit e image verificables.")
      state = Object.fromEntries(services.map((service) => [service, { sha: previous.commit, image: previous.image }]))
    }
    for (const service of services) {
      if (!shaPattern.test(state[service]?.sha ?? "") || !state[service]?.image) throw new Error(`Estado inválido de ${service}.`)
      const id = compose(["ps", "-q", service], existsSync(imagesPath) ? imagesPath : undefined)
      if (!id) throw new Error(`No está corriendo ${service}; revisa producción antes de desplegar.`)
      const actual = execute("docker", ["inspect", "--format", "{{.Image}}", id])
      const expected = execute("docker", ["image", "inspect", "--format", "{{.Id}}", state[service].image])
      if (actual !== expected) throw new Error(`La imagen real de ${service} no coincide con el estado; recupera el despliegue interrumpido antes de reintentar.`)
      git("merge-base", "--is-ancestor", state[service].sha, sha)
    }
    const selected = services.filter((service) => {
      const paths = git("diff", "--name-only", "--no-renames", "-z", state[service].sha, sha).split("\0").filter(Boolean)
      return affectedServices(paths).includes(service)
    })
    const migrations = git("diff", "--name-only", "--no-renames", "-z", state.app.sha, sha).split("\0").some((path) => path.startsWith("prisma/migrations/"))
    if (!selected.length) {
      writeJson(statePath, Object.fromEntries(services.map((service) => [service, { ...state[service], sha }])))
      console.log(`Sin cambios de runtime para ${sha}.`)
      return { services: [] }
    }
    const image = `lucaplan-local:${sha}`
    const config = JSON.parse(compose(["config", "--format", "json"]))
    const landingOnly = config.services.app.environment.NEXT_PUBLIC_LANDING_ONLY
    if (!["true", "false"].includes(String(landingOnly))) throw new Error("NEXT_PUBLIC_LANDING_ONLY debe ser true o false en el runtime.")
    console.log(`Construyendo ${sha}; servicios: ${selected.join(", ")}.`)
    execute("docker", ["build", "--build-arg", `NEXT_PUBLIC_LANDING_ONLY=${landingOnly}`, "--label", `org.opencontainers.image.revision=${sha}`, "-t", image, "."], { cwd, stdio: "inherit" })
    // Un merge durante el build debe esperar su propia validación de CI.
    if (git("ls-remote", "origin", "refs/heads/master").split(/\s/)[0] !== sha) return { skipped: true }
    const previousImages = { services: Object.fromEntries(services.map((service) => [service, { image: state[service].image }])) }
    writeJson(join(runtimeDir, "deploy-previous.json"), previousImages)
    writeJson(join(runtimeDir, "deploy-previous-state.json"), state)
    const next = Object.fromEntries(services.map((service) => [service, { sha, image: selected.includes(service) ? image : state[service].image }]))
    writeJson(candidatePath, { services: Object.fromEntries(services.map((service) => [service, { image: next[service].image }])) })
    let backup
    if (selected.includes("app")) {
      const backupDir = join(runtimeDir, "backups")
      mkdirSync(backupDir, { recursive: true })
      backup = join(backupDir, `${Date.now()}-${sha}.dump`)
      const output = openSync(backup, "wx", 0o600)
      try {
        execute("docker", [...composeArgs, "exec", "-T", "postgres", "pg_dump", "-U", "lucaplan", "-d", "lucaplan", "-Fc"], { stdio: ["ignore", output, "pipe"] })
      } finally { closeSync(output) }
      const input = openSync(backup, "r")
      try {
        execute("docker", [...composeArgs, "exec", "-T", "postgres", "pg_restore", "--list"], { stdio: [input, "ignore", "pipe"] })
      } finally { closeSync(input) }
      // El cron no debe escribir mientras la app aplica migraciones.
      if (migrations) compose(["stop", "cron"])
      compose(["up", "-d", "--no-deps", "--wait", "--wait-timeout", "180", "app"], candidatePath)
      if (migrations || selected.includes("cron")) compose(["up", "-d", "--no-deps", "--wait", "--wait-timeout", "60", "cron"], candidatePath)
    } else {
      compose(["up", "-d", "--no-deps", "--wait", "--wait-timeout", "60", "cron"], candidatePath)
    }
    writeJson(imagesPath, { services: Object.fromEntries(services.map((service) => [service, { image: next[service].image }])) })
    writeJson(statePath, next)
    writeJson(join(runtimeDir, "last-auto-deploy.json"), { commit: sha, services: selected, backup, completedAt: new Date().toISOString() })
    console.log(`Despliegue confirmado: ${sha}; ${selected.join(", ")}. Compose verificó los servicios recreados; cron solo comprueba running, no sus tareas.`)
    return { services: selected }
  } finally {
    closeSync(lock)
    rmSync(lockPath)
  }
}

if (import.meta.main) {
  try {
    deploy({ sha: process.argv[2], runtimeDir: process.env.LUCA_RUNTIME_DIR })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
