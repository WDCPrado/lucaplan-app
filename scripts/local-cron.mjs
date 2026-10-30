import { spawn } from "node:child_process"
import { setTimeout } from "node:timers/promises"

export function dueJobs(now, previous) {
  const jobs = []
  if (Math.floor(now / 300_000) !== Math.floor(previous / 300_000)) {
    jobs.push("scripts/sync-email.ts")
  }
  if (Math.floor(now / 86_400_000) !== Math.floor(previous / 86_400_000)) {
    jobs.push("scripts/notify-due.ts")
  }
  return jobs
}

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit" })
    // Un proveedor que no responde no debe bloquear todas las corridas siguientes.
    const timeout = globalThis.setTimeout(() => child.kill("SIGKILL"), 240_000)
    child.on("error", (error) => console.error(`[cron] ${script}:`, error.message))
    child.on("close", (code) => {
      globalThis.clearTimeout(timeout)
      if (code !== 0) console.error(`[cron] ${script} terminó con código ${code}`)
      resolve()
    })
  })
}

if (import.meta.main) {
  console.log("[cron] Correo cada 5 minutos; recordatorios a las 00:00 UTC.")
  let previous = Date.now()
  while (true) {
    await setTimeout(60_000 - (Date.now() % 60_000))
    const now = Date.now()
    for (const script of dueJobs(now, previous)) await run(script)
    previous = now
  }
}
