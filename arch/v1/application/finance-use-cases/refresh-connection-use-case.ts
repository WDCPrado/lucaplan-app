// Refresco manual (y del webhook): re-sincroniza un banco conectado del usuario por su bankId.
// Reutiliza la sincronización idempotente. Valida ownership y que el banco sea de origen fintoc.
import {
  AccountNotFoundError,
  BankConnectionError,
  NotOwnerError,
} from "../../domain/finance/finance.domain.ts"
import { syncLink, type SyncDeps } from "./sync-link-use-case.ts"

export async function refreshConnection(
  deps: SyncDeps,
  userId: string,
  bankId: string
) {
  const bank = await deps.banks.findById(bankId)
  if (!bank) throw new AccountNotFoundError(bankId)
  if (bank.userId !== userId) throw new NotOwnerError()
  if (bank.provider !== "fintoc" || !bank.externalLinkId || !bank.linkToken) {
    throw new BankConnectionError("El banco no está conectado con Fintoc")
  }
  return syncLink(deps, userId, {
    linkId: bank.externalLinkId,
    linkToken: bank.linkToken,
    institutionName: bank.name,
  })
}
