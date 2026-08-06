// Frecuencia del ritmo de gasto (Configuración → Ritmo de gasto): diario o semanal.
// Preferencia GLOBAL de la app, igual que la anticipación de vencimientos: se exige sesión, pero
// el valor es el mismo para cualquier usuario autenticado.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import {
  getPaceFrequency,
  setPaceFrequency,
} from "@/arch/v1/application/finance-use-cases/pace-use-cases"
import { paceDeps } from "@/arch/v1/infrastructure/database/prisma/pace.infrastructure"

export async function GET(req: Request) {
  return withUser(req, async () => ({
    frequency: await getPaceFrequency(paceDeps),
  }))
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const frequency = String(body?.frequency ?? "")
  return withUser(req, async () => ({
    frequency: await setPaceFrequency(paceDeps, frequency),
  }))
}
