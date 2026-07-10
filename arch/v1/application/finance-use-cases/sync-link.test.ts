// Sincronización de un Link con fakes en memoria (dedupe por id externo, como el upsert de Prisma).
// Corre con: node --test arch/v1/application/finance-use-cases/sync-link.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncLink, type SyncDeps } from "./sync-link-use-case.ts";
import type { BankAggregationProvider } from "../../domain/finance/bank-aggregation.port.ts";
import type {
  Account,
  Bank,
  ConnectedAccountInput,
  ConnectedBankInput,
  ImportMovement,
} from "../../domain/finance/finance.domain.ts";

const provider: BankAggregationProvider = {
  async listAccounts() {
    return [
      {
        externalId: "acc_A",
        name: "Cuenta",
        officialName: null,
        rawType: "checking_account",
        currency: "CLP",
        numberLast4: "1234",
        balanceCurrent: 500000, // saldo del proveedor
        balanceLimit: 0,
      },
    ];
  },
  async listMovements() {
    return [
      { externalId: "mov_1", description: "Compra", amount: -3000, currency: "CLP", postDate: "2026-07-01", transactionDate: "2026-07-01", status: "confirmed", pending: false },
      { externalId: "mov_2", description: "Abono", amount: 10000, currency: "CLP", postDate: "2026-07-02", transactionDate: "2026-07-02", status: "confirmed", pending: false },
    ];
  },
};

type FakeTxRow = { accountId: string; externalId: string; amount: number; categoryId: string | null };

function makeDeps() {
  const banks: Bank[] = [];
  const accounts: Account[] = [];
  const txs: FakeTxRow[] = [];
  const deps: SyncDeps = {
    provider,
    banks: {
      async listByUser() {
        return banks;
      },
      async create() {
        throw new Error("no usado");
      },
      async findById(id) {
        return banks.find((b) => b.id === id) ?? null;
      },
      async findByExternalLinkId(x) {
        return banks.find((b) => b.externalLinkId === x) ?? null;
      },
      async upsertConnected(input: ConnectedBankInput) {
        let b = banks.find((x) => x.userId === input.userId && x.externalLinkId === input.externalLinkId);
        if (!b) {
          b = { id: "bank1", userId: input.userId, name: input.name, isActive: true, provider: "fintoc", externalLinkId: input.externalLinkId, linkToken: input.linkToken, lastSyncedAt: null };
          banks.push(b);
        } else b.linkToken = input.linkToken;
        return b;
      },
      async delete() {},
    },
    accounts: {
      async listByUser() {
        return accounts;
      },
      async findById(id) {
        return accounts.find((a) => a.id === id) ?? null;
      },
      async create() {
        throw new Error("no usado");
      },
      async listByBank(bankId) {
        return accounts.filter((a) => a.bankId === bankId);
      },
      async upsertConnected(input: ConnectedAccountInput) {
        let a = accounts.find((x) => x.userId === input.userId && x.externalId === input.externalId);
        if (!a) {
          a = { id: "acc_" + input.externalId, userId: input.userId, bankId: input.bankId, name: input.name, accountType: input.accountType, currency: input.currency, balance: input.balance, overdraftLimit: input.overdraftLimit, color: null, cardLast4: input.cardLast4, provider: "fintoc", externalId: input.externalId };
          accounts.push(a);
        } else a.balance = input.balance; // saldo del proveedor sobrescribe
        return a;
      },
    },
    transactions: {
      async listByUserPeriod() {
        return [];
      },
      async listByCategoryPeriod() {
        return [];
      },
      async create() {
        throw new Error("no usado");
      },
      async findById() {
        return null;
      },
      async update() {
        throw new Error("no usado");
      },
      async delete() {},
      // Dedupe por (accountId, externalId), preservando categoryId (como el upsert de Prisma).
      async importMovements(_userId: string, accountId: string, movements: ImportMovement[]) {
        for (const m of movements) {
          const found = txs.find((t) => t.accountId === accountId && t.externalId === m.externalId);
          if (found) found.amount = m.amount.toMajor();
          else txs.push({ accountId, externalId: m.externalId, amount: m.amount.toMajor(), categoryId: null });
        }
      },
    },
  };
  return { deps, banks, accounts, txs };
}

test("syncLink: primera sync crea banco, cuenta y movimientos; usa el saldo del proveedor", async () => {
  const { deps, banks, accounts, txs } = makeDeps();
  const res = await syncLink(deps, "u1", { linkId: "link_1", linkToken: "lt_1", institutionName: "Banco X" });
  assert.equal(res.accounts, 1);
  assert.equal(res.movements, 2);
  assert.equal(banks.length, 1);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].balance.toMajor(), 500000); // saldo autoritativo del proveedor
  assert.equal(txs.length, 2);
});

test("syncLink: re-sync es idempotente (no duplica) y preserva la categoría", async () => {
  const { deps, txs } = makeDeps();
  await syncLink(deps, "u1", { linkId: "link_1", linkToken: "lt_1", institutionName: "Banco X" });
  txs[0].categoryId = "cat-user"; // categorización futura (IA)
  await syncLink(deps, "u1", { linkId: "link_1", linkToken: "lt_1", institutionName: "Banco X" });
  assert.equal(txs.length, 2); // sin duplicados
  assert.equal(txs[0].categoryId, "cat-user"); // categoría preservada
});
