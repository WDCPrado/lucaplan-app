// Desconectar un banco conectado por Fintoc: revoca el Link en Fintoc (deja de refrescar/cobrar) y
// elimina el banco local — por cascada, sus cuentas y todos sus movimientos. Valida ownership y
// origen fintoc. La revocación es best-effort: si Fintoc falla, igual se borra local.
import {
  AccountNotFoundError,
  NotOwnerError,
  BankConnectionError,
  type BankRepository,
} from "../../domain/finance/finance.domain.ts"
import type { BankAggregationProvider } from "../../domain/finance/bank-aggregation.port.ts"

export async function disconnectBank(
  deps: { banks: BankRepository; provider: BankAggregationProvider },
  userId: string,
  bankId: string
): Promise<void> {
  const bank = await deps.banks.findById(bankId)
  if (!bank) throw new AccountNotFoundError(bankId)
  if (bank.userId !== userId) throw new NotOwnerError()
  if (bank.provider !== "fintoc")
    throw new BankConnectionError(
      "Solo se pueden desconectar bancos conectados por Fintoc"
    )

  // Revocar el Link en Fintoc. Best-effort: si falla, no dejamos al usuario atascado → borramos local.
  if (bank.externalLinkId) {
    try {
      await deps.provider.revokeLink(bank.externalLinkId)
    } catch (e) {
      console.error("[fintoc] revoke link falló (se borra local igual):", e)
    }
  }

  await deps.banks.delete(bankId)
}
