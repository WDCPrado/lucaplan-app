// Sincroniza un Link de Fintoc: institución → banco, cuentas y movimientos. Idempotente (upsert por
// id externo). Saldo del proveedor (autoritativo); movimientos sin categoría (categorización con IA
// es un paso posterior). No ajusta el saldo local. Reutilizado por conectar, refrescar y webhook.
import type {
  AccountRepository,
  BankRepository,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts";
import type { BankAggregationProvider } from "../../domain/finance/bank-aggregation.port.ts";
import { mapProviderAccount, mapProviderMovement } from "./fintoc-map.ts";

export type SyncDeps = {
  banks: BankRepository;
  accounts: AccountRepository;
  transactions: TransactionRepository;
  provider: BankAggregationProvider;
};

export type SyncLinkInput = {
  linkId: string; // link_...
  linkToken: string; // token secreto del Link
  institutionName: string;
};

export async function syncLink(
  deps: SyncDeps,
  userId: string,
  input: SyncLinkInput,
): Promise<{ bankId: string; accounts: number; movements: number }> {
  // listAccounts valida el linkToken (falla con BankConnectionError si es inválido).
  const providerAccounts = await deps.provider.listAccounts(input.linkToken);
  const bank = await deps.banks.upsertConnected({
    userId,
    name: input.institutionName || "Banco",
    externalLinkId: input.linkId,
    linkToken: input.linkToken,
  });

  // Cuentas en paralelo: aparecen juntas rápido (mejor UX); los movimientos de cada una en lotes.
  const results = await Promise.all(
    providerAccounts.map(async (pa) => {
      const mapped = mapProviderAccount(pa);
      if (!mapped) return { accounts: 0, movements: 0 }; // moneda no soportada → se omite
      const account = await deps.accounts.upsertConnected({
        userId,
        bankId: bank.id,
        externalId: pa.externalId,
        name: pa.name,
        ...mapped,
      });
      const raw = await deps.provider.listMovements(input.linkToken, pa.externalId, { confirmedOnly: false });
      const toImport = raw.map(mapProviderMovement).filter((m): m is NonNullable<typeof m> => m !== null);
      await deps.transactions.importMovements(userId, account.id, toImport);
      return { accounts: 1, movements: toImport.length };
    }),
  );
  return {
    bankId: bank.id,
    accounts: results.reduce((s, r) => s + r.accounts, 0),
    movements: results.reduce((s, r) => s + r.movements, 0),
  };
}
