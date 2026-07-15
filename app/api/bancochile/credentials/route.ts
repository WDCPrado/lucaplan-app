// Credenciales de Banco de Chile del usuario logueado: guardar (cifra la clave), consultar estado
// (sin exponer la clave) y borrar. La clave nunca se devuelve por la API.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import {
  saveBancoChileCreds,
  bancoChileCredStatus,
  deleteBancoChileCreds,
} from "@/arch/v1/infrastructure/http/bancochile/bancochile-credentials"
import { ConnectionMethodConflictError } from "@/arch/v1/domain/finance/email-connection.domain"
import { connectionMethodRepository } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"

export async function GET(req: Request) {
  return withUser(req, (userId) => bancoChileCredStatus(userId))
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    rut?: string
    pass?: string
  }
  return withUser(req, async (userId) => {
    const rut = String(body.rut ?? "").trim()
    const pass = String(body.pass ?? "")
    if (!rut || !pass) return { ok: false, error: "Faltan RUT o clave" }
    // Exclusividad de método: con el banco conectado por correo, el scraper no se configura.
    const active = await connectionMethodRepository.activeMethod(
      userId,
      "bancochile"
    )
    if (active === "email") throw new ConnectionMethodConflictError("email")
    await saveBancoChileCreds(userId, rut, pass)
    return { ok: true }
  })
}

export async function DELETE(req: Request) {
  return withUser(req, async (userId) => {
    await deleteBancoChileCreds(userId)
    return { ok: true }
  })
}
