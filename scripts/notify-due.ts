// Recordatorio de pagos por vencer (recurrentes y cuotas) para CRON / tarea programada.
// Recorre a los usuarios que tienen al menos un dispositivo suscrito y les envía UNA notificación
// con lo que vence en los próximos días. Sin nada por vencer no envía nada.
//
//   pnpm notify:due            # ventana por defecto: 2 días
//   pnpm notify:due -- 5       # ventana de 5 días
//
// Pensado para correr UNA vez al día (ej. 9:00). Correrlo más seguido repite el mismo aviso.
import { notifyDueSoon } from "../arch/v1/application/notification-use-cases/notify-due-use-case.ts"
import { notifyDueDeps } from "../arch/v1/infrastructure/database/prisma/push-deps.ts"
import { prisma } from "../arch/v1/infrastructure/database/prisma/client.ts"

const windowDays = Number(process.argv[2]) || 2

try {
  const subscribed = await prisma.pushSubscription.findMany({
    distinct: ["userId"],
    select: { userId: true },
  })
  let sent = 0
  for (const { userId } of subscribed) {
    sent += await notifyDueSoon(notifyDueDeps, userId, new Date(), windowDays)
  }
  console.log(
    `[${new Date().toISOString()}] Recordatorios OK: ${subscribed.length} usuarios, ${sent} envíos.`
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
