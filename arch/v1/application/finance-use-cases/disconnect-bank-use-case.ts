// Desconectar un banco conectado por Fintoc: elimina el banco y, por cascada, sus cuentas y todos
// sus movimientos. Valida ownership y que sea de origen fintoc.
import {
  AccountNotFoundError,
  NotOwnerError,
  BankConnectionError,
  type BankRepository,
} from "../../domain/finance/finance.domain.ts";

export async function disconnectBank(deps: { banks: BankRepository }, userId: string, bankId: string): Promise<void> {
  const bank = await deps.banks.findById(bankId);
  if (!bank) throw new AccountNotFoundError(bankId);
  if (bank.userId !== userId) throw new NotOwnerError();
  if (bank.provider !== "fintoc") throw new BankConnectionError("Solo se pueden desconectar bancos conectados por Fintoc");
  await deps.banks.delete(bankId);
}
