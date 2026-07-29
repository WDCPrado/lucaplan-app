// Recordatorio de pagos por vencer (recurrentes y cuotas) por consola. La misma pasada que expone
// `POST /api/cron/notify-due`: úsalo para probar a mano; en el despliegue lo dispara el scheduler
// contra el endpoint.
//
//   pnpm notify:due            # ventana configurada en Configuración → Pagos por vencer
//   pnpm notify:due -- 5       # ventana de 5 días (puntual, ignora la configuración)
import { runDueReminders } from "../arch/v1/infrastructure/database/prisma/push-deps.ts"
import { prisma } from "../arch/v1/infrastructure/database/prisma/client.ts"

const arg = Number(process.argv[2])

try {
  const { users, sent, windowDays } = await runDueReminders(
    Number.isFinite(arg) ? arg : undefined
  )
  console.log(
    `[${new Date().toISOString()}] Recordatorios OK (${windowDays} días): ${users} usuarios, ${sent} envíos.`
  )
} catch (e) {
  console.error(
    `[${new Date().toISOString()}] Recordatorios FALLARON:`,
    (e as Error).message
  )
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
