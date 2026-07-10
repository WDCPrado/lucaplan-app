// Port de agregación bancaria (lo implementa Fintoc en infraestructura). El dominio define el
// contrato con datos "crudos" del proveedor; la aplicación los mapea a entidades (AccountType,
// Money, direction, status). No conoce HTTP ni fetch.

export type ProviderAccount = {
  externalId: string; // acc_...
  name: string;
  officialName: string | null;
  rawType: string; // tipo crudo de Fintoc: checking_account, sight_account, savings_account, ...
  currency: string; // ISO 4217 crudo
  numberLast4: string | null; // últimos 4 del número de cuenta
  balanceCurrent: number; // saldo actual, unidad mínima (entero)
  balanceLimit: number | null; // límite (cupo/sobregiro), unidad mínima
};

export type ProviderMovement = {
  externalId: string; // mov_...
  description: string;
  amount: number; // unidad mínima, con signo (+ ingreso / − gasto)
  currency: string; // ISO 4217 crudo
  postDate: string; // ISO 8601
  transactionDate: string; // ISO 8601
  status: string | null; // confirmed | pending | reversed | duplicated (puede faltar → derivar de pending)
  pending: boolean;
};

export interface BankAggregationProvider {
  // Lista las cuentas del Link. Valida implícitamente el linkToken (falla si es inválido).
  listAccounts(linkToken: string): Promise<ProviderAccount[]>;
  // Lista los movimientos de una cuenta del Link. confirmedOnly=false trae todo el ciclo
  // (pending/reversed/duplicated). updatedSince (ISO) → solo lo creado/actualizado desde entonces
  // (sync incremental); ausente = histórico completo (primera conexión).
  listMovements(
    linkToken: string,
    accountExternalId: string,
    opts?: { confirmedOnly?: boolean; updatedSince?: Date },
  ): Promise<ProviderMovement[]>;
  // Revoca el Link en Fintoc: deja de refrescarlo, invalida su link_token y deja de cobrarlo.
  // Idempotente: si el Link ya no existe (404), se considera hecho.
  revokeLink(linkId: string): Promise<void>;
}
