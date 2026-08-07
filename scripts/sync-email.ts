// Corrida de sincronización del método correo (Outlook) para CRON / tarea programada.
// Ejecuta el delta de Microsoft Graph: importa idempotente, proyecta buckets y categoriza los
// movimientos nuevos. Mismo efecto que "Sincronizar ahora" en la app; alternativa local al
// webhook, que exige una URL HTTPS pública (ver docs/email-connection-outlook.md).
//
//   pnpm sync:email
//   # o programado (Windows Task Scheduler / cron) apuntando a ese comando, cada pocos minutos.
import { syncUserMailboxes } from "../arch/v1/application/finance-use-cases/email-connection-use-cases.ts"
import { makeEmailConnectionDeps } from "../arch/v1/infrastructure/database/prisma/email-connection.infrastructure.ts"
import { prisma } from "../arch/v1/infrastructure/database/prisma/client.ts"

async function resolveUserId(): Promise<string> {
  if (process.env.OUTLOOK_USER_ID) return process.env.OUTLOOK_USER_ID
  // Sin env: el usuario dueño del buzón Outlook activo (el que conectó en la app).
  const mailbox = await prisma.emailMailbox.findFirst({
    where: { status: "active" },
  })
  if (mailbox) return mailbox.userId
  throw new Error(
    "No hay un correo Outlook conectado. Conéctate en la app o configura OUTLOOK_USER_ID."
  )
}

try {
  const userId = await resolveUserId()
  const res = await syncUserMailboxes(makeEmailConnectionDeps(), userId)
  console.log(`[${new Date().toISOString()}] Sync email OK:`, res)
} catch (e) {
  console.error(
    `[${new Date().toISOString()}] Sync email FALLÓ:`,
    (e as Error).message
  )
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
