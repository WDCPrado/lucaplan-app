// Conecta un banco: recibe el Link que entregó el widget (onSuccess) y hace la PRIMERA
// sincronización. El linkToken llega del cliente; el backend lo valida contra Fintoc al sincronizar.
import { BankConnectionError } from "../../domain/finance/finance.domain.ts";
import { syncLink, type SyncDeps } from "./sync-link-use-case.ts";

export type ConnectBankInput = {
  linkId: string;
  linkToken: string;
  institutionName: string;
};

export async function connectBank(deps: SyncDeps, userId: string, input: ConnectBankInput) {
  if (!input.linkToken) throw new BankConnectionError("Falta el token del Link");
  return syncLink(deps, userId, input);
}
