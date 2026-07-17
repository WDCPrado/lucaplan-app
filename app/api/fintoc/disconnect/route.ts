import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { disconnectBank } from "@/arch/v1/application/finance-use-cases/disconnect-bank-use-case"

// Desconectar un banco conectado: elimina el banco y (por cascada) sus cuentas y movimientos.
export async function POST(req: Request) {
  const body = await req.json()
  return withUser(req, async (userId) => {
    await disconnectBank(financeDeps, userId, String(body.bankId ?? ""))
    return { ok: true }
  })
}
