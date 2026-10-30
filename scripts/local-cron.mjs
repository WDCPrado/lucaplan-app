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
  if (Math.floor(now / 43_200_000) !== Math.floor(previous / 43_200_000)) {
    jobs.push("renew-outlook")
  }
  return jobs
}

export async function renewOutlook(
  secret = process.env.OUTLOOK_RENEW_SECRET,
  request = fetch
) {
  if (!secret)
    throw new Error("Falta OUTLOOK_RENEW_SECRET para renovar Outlook.")
  let response
  try {
    response = await request("http://app:3005/api/email-connection/renew", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(240_000),
    })
  } catch {
    throw new Error("No se pudo conectar al endpoint de renovacion de Outlook.")
  }
  if (!response.ok)
    throw new Error(`Renovacion Outlook: HTTP ${response.status}.`)
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error("Respuesta de renovacion Outlook invalida.")
  }
  if (result.failed > 0)
    throw new Error("La renovacion Outlook reporto buzones fallidos.")
  console.log("[cron] Renovacion Outlook completada.")
}

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit" })
    // Un proveedor que no responde no debe bloquear todas las corridas siguientes.
    const timeout = globalThis.setTimeout(() => child.kill("SIGKILL"), 240_000)
    child.on("error", (error) =>
      console.error(`[cron] ${script}:`, error.message)
    )
    child.on("close", (code) => {
      globalThis.clearTimeout(timeout)
      if (code !== 0)
        console.error(`[cron] ${script} terminó con código ${code}`)
      resolve()
    })
  })
}

if (import.meta.main) {
  console.log(
    "[cron] Correo cada 5 minutos; recordatorios 00:00 UTC; renovar Outlook 00:00 y 12:00 UTC."
  )
  let previous = Date.now()
  while (true) {
    await setTimeout(60_000 - (Date.now() % 60_000))
    const now = Date.now()
    for (const script of dueJobs(now, previous)) {
      if (script === "renew-outlook") {
        try {
          await renewOutlook()
        } catch (error) {
          console.error("[cron]", error.message)
        }
      } else {
        await run(script)
      }
    }
    previous = now
  }
}
