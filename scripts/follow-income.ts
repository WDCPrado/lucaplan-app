// Tope que sigue al ingreso al empezar un período, por consola. La misma pasada que expone
// `POST /api/cron/follow-income`: úsalo para probar a mano; en el despliegue lo dispara el
// scheduler contra el endpoint.
//
//   pnpm follow:income
import { runFollowIncome } from "../arch/v1/infrastructure/database/prisma/follow-income.infrastructure.ts"
import { prisma } from "../arch/v1/infrastructure/database/prisma/client.ts"

try {
  const { users, adjusted } = await runFollowIncome()
  console.log(
    `[${new Date().toISOString()}] Tope que sigue al ingreso OK: ${users} usuarios, ${adjusted} ajustados.`
  )
} catch (e) {
  console.error(
    `[${new Date().toISOString()}] Tope que sigue al ingreso FALLÓ:`,
    (e as Error).message
  )
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
