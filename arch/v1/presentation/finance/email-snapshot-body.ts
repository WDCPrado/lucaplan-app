// Parseo del body del snapshot de saldos del método correo (confirmación inicial y "Actualizar
// saldos"). Montos en unidad mayor (CLP entero, USD con decimales) → Money. Sin lógica de negocio:
// solo validación de forma; las reglas viven en los use-cases.
import { Money } from "../../domain/finance/money.ts"
import { EmailSetupStateError } from "../../domain/finance/email-connection.domain.ts"
import type { EmailSnapshotInput } from "../../application/finance-use-cases/email-connection-use-cases.ts"

type RawLimitAvailable =
  | { limit?: number; available?: number }
  | null
  | undefined

function limitAvailable(
  raw: RawLimitAvailable,
  currency: "CLP" | "USD"
): { limit: Money; used: Money } | null {
  if (!raw) return null
  const limit = Number(raw.limit)
  const available = Number(raw.available)
  if (
    !Number.isFinite(limit) ||
    !Number.isFinite(available) ||
    limit < 0 ||
    available < 0 ||
    available > limit
  ) {
    throw new EmailSetupStateError(
      "El disponible debe estar entre cero y el cupo total"
    )
  }
  return {
    limit: Money.of(limit, currency),
    used: Money.of(limit - available, currency),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseSnapshotBody(body: any): EmailSnapshotInput {
  const snapshotAt = new Date(body?.snapshotAt ?? "")
  if (Number.isNaN(snapshotAt.getTime()))
    throw new EmailSetupStateError("Falta la fecha del snapshot")

  let checking: EmailSnapshotInput["checking"] = null
  if (body?.checking) {
    const ref = String(body.checking.ref ?? "").replace(/\D/g, "")
    const cash = Number(body.checking.cash)
    if (ref.length < 4)
      throw new EmailSetupStateError(
        "El número de cuenta debe tener al menos 4 dígitos"
      )
    if (!Number.isFinite(cash) || cash < 0)
      throw new EmailSetupStateError("Saldo de caja inválido")
    checking = {
      ref,
      cash: Money.of(cash, "CLP"),
      overdraft: limitAvailable(body.checking.overdraft, "CLP"),
    }
  }

  const rawCards: unknown[] = Array.isArray(body?.cards) ? body.cards : []
  const cards = rawCards.map((c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const card = c as any
    const last4 = String(card?.last4 ?? "").replace(/\D/g, "")
    if (!/^\d{4}$/.test(last4))
      throw new EmailSetupStateError(
        "Los últimos 4 de la tarjeta deben ser 4 dígitos"
      )
    return {
      last4,
      national: limitAvailable(card?.national, "CLP"),
      international: limitAvailable(card?.international, "USD"),
    }
  })

  return { snapshotAt, checking, cards }
}
