// Sync local con fakes en memoria (sin navegador ni DB). Verifica: mapeo a entidades, sobregiro
// calculado, upsert idempotente de cartola con ventana solapada, y snapshot-replace de no facturados.
// Corre con: node --test arch/v1/application/finance-use-cases/sync-local-connection.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncLocalConnection, type SyncLocalDeps } from "./sync-local-connection-use-case.ts";
import type {
  LocalBankConnector,
  RawMovement,
  RawUnbilledMovement,
} from "../../domain/finance/local-bank-connector.port.ts";
import type { ConnectedBucketInput, ImportMovement } from "../../domain/finance/finance.domain.ts";

const NOW = new Date(Date.UTC(2026, 6, 11));
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

// Conector fake: 1 cuenta corriente (cash + overdraft) y 1 tarjeta de crédito (nacional + internacional).
function makeConnector(over?: Partial<LocalBankConnector>): LocalBankConnector {
  return {
    async ensureSession() {},
    async readProducts() {
      return {
        institutionName: "Banco de Chile",
        products: [
          {
            externalId: "1643348900",
            name: "Cuenta Corriente",
            rawType: "CUENTA_CORRIENTE",
            currency: "CLP",
            last4: "8900",
            buckets: [
              { kind: "cash", currency: "CLP", limit: 0, used: 0, available: 34210 },
              // Línea 1M, disponible 900k ⇒ usado 100k (calculado por el use-case).
              { kind: "overdraft", currency: "CLP", limit: 1000000, used: null, available: 900000 },
            ],
          },
          {
            externalId: "TC-2120",
            name: "Visa Signature",
            rawType: "TARJETA_CREDITO",
            currency: "CLP",
            last4: "2120",
            buckets: [
              { kind: "credit_national", currency: "CLP", limit: 3272200, used: 2139851, available: 1094115 },
              { kind: "credit_international", currency: "USD", limit: 210000, used: 4851, available: 169462 },
            ],
          },
        ],
      };
    },
    async readCartola(): Promise<RawMovement[]> {
      return [
        { externalId: "m1", date: day(2026, 6, 10), description: "Compra", amount: -3000, currency: "CLP" },
        { externalId: "m2", date: day(2026, 6, 9), description: "Abono", amount: 50000, currency: "CLP" },
      ];
    },
    async readUnbilled(): Promise<RawUnbilledMovement[]> {
      return [
        { date: day(2026, 6, 10), description: "DR. CLINICA", amount: 86795, currency: "CLP", scope: "national", installments: null },
        { date: day(2026, 6, 8), description: "PAYWASH", amount: 1400, currency: "CLP", scope: "national", installments: null },
        { date: day(2026, 6, 8), description: "PAYWASH", amount: 1400, currency: "CLP", scope: "national", installments: null }, // idéntico legítimo
        { date: day(2026, 6, 7), description: "AWS", amount: 4851, currency: "USD", scope: "international", installments: null },
      ];
    },
    async close() {},
    ...over,
  };
}

function makeDeps(connector: LocalBankConnector, lastSyncedAt: Date | null = null) {
  const state = {
    banks: [] as { id: string; name: string; lastSyncedAt: Date | null }[],
    accounts: [] as { id: string; externalId: string; accountType: string }[],
    cards: [] as { id: string; accountId: string; last4: string }[],
    buckets: [] as (ConnectedBucketInput & { id: string })[],
    cartola: [] as { accountId: string; externalId: string; categoryId: string | null }[],
    unbilled: [] as { cardId: string; bucketId: string; description: string; amount: number }[],
  };
  let seq = 0;
  const id = (p: string) => `${p}${++seq}`;
  const deps: SyncLocalDeps = {
    connector,
    async upsertBank(_userId, name) {
      let b = state.banks[0];
      if (!b) { b = { id: "bank1", name, lastSyncedAt }; state.banks.push(b); }
      return { id: b.id, lastSyncedAt: b.lastSyncedAt };
    },
    async upsertAccount(input) {
      let a = state.accounts.find((x) => x.externalId === input.externalId);
      if (!a) { a = { id: id("acc"), externalId: input.externalId, accountType: input.accountType }; state.accounts.push(a); }
      return { id: a.id };
    },
    async upsertCard(input) {
      let c = state.cards.find((x) => x.accountId === input.accountId && x.last4 === input.cardLast4);
      if (!c) { c = { id: id("card"), accountId: input.accountId, last4: input.cardLast4 }; state.cards.push(c); }
      return { id: c.id };
    },
    async upsertBucket(input) {
      let b = state.buckets.find((x) => x.accountId === input.accountId && x.cardId === input.cardId && x.kind === input.kind && x.currency === input.currency);
      if (!b) { b = { ...input, id: id("bkt") }; state.buckets.push(b); }
      else Object.assign(b, input);
      return { id: b.id };
    },
    async importCartola(_userId, accountId, _bucketId, movements: ImportMovement[]) {
      for (const m of movements) {
        const found = state.cartola.find((t) => t.accountId === accountId && t.externalId === m.externalId);
        if (!found) state.cartola.push({ accountId, externalId: m.externalId, categoryId: null });
      }
      return movements.length;
    },
    async replaceUnbilled(_userId, _accountId, cardId, movements) {
      // Snapshot-replace: borra los de esta tarjeta e inserta la foto nueva.
      state.unbilled = state.unbilled.filter((u) => u.cardId !== cardId);
      for (const m of movements) state.unbilled.push({ cardId, bucketId: m.bucketId, description: m.description, amount: m.amount.toMajor() });
      return movements.length;
    },
    async setAccountBalance() {},
    async markSynced(bankId) {
      const b = state.banks.find((x) => x.id === bankId);
      if (b) b.lastSyncedAt = NOW;
    },
  };
  return { deps, state };
}

test("sync local: crea banco, cuentas, tarjetas y buckets; sobregiro usado se calcula", async () => {
  const { deps, state } = makeDeps(makeConnector());
  const res = await syncLocalConnection(deps, "u1", { now: NOW });
  assert.equal(res.accounts, 2); // corriente + tarjeta
  assert.equal(res.cards, 2); // débito + crédito
  assert.equal(state.buckets.length, 4); // cash + overdraft + nacional + internacional
  const overdraft = state.buckets.find((b) => b.kind === "overdraft");
  assert.equal(overdraft?.used.toMajor(), 100000); // 1M autorizado − 900k disponible = 100k deuda
  const intl = state.buckets.find((b) => b.kind === "credit_international");
  assert.equal(intl?.currency, "USD");
});

test("sync local: cartola importa la ventana; los no facturados van a su bucket por ámbito", async () => {
  const { deps, state } = makeDeps(makeConnector());
  await syncLocalConnection(deps, "u1", { now: NOW });
  assert.equal(state.cartola.length, 2);
  assert.equal(state.unbilled.length, 4); // incluye las 2 PAYWASH idénticas (no se fusionan)
  const natBucket = state.buckets.find((b) => b.kind === "credit_national")!.id;
  const intlBucket = state.buckets.find((b) => b.kind === "credit_international")!.id;
  assert.equal(state.unbilled.filter((u) => u.bucketId === natBucket).length, 3);
  assert.equal(state.unbilled.filter((u) => u.bucketId === intlBucket).length, 1);
});

test("sync local: re-sync hace snapshot-replace (no acumula no facturados) y upsert de cartola idempotente", async () => {
  const { deps, state } = makeDeps(makeConnector(), day(2026, 6, 10)); // ya sincronizado antes
  await syncLocalConnection(deps, "u1", { now: NOW });
  await syncLocalConnection(deps, "u1", { now: NOW });
  assert.equal(state.cartola.length, 2); // cartola no se duplica (upsert por id)
  assert.equal(state.unbilled.length, 4); // no facturados reemplazados, no acumulados (4, no 8)
});

test("sync local: snapshot-replace conserva la foto previa si la lectura falla", async () => {
  const { deps, state } = makeDeps(makeConnector());
  await syncLocalConnection(deps, "u1", { now: NOW }); // primera foto ok
  const before = state.unbilled.length;
  // Segunda sync: readUnbilled falla → replaceUnbilled no se llama → foto previa intacta.
  const failing = makeConnector({ async readUnbilled() { throw new Error("403 bloqueo"); } });
  const deps2 = { ...deps, connector: failing };
  await assert.rejects(() => syncLocalConnection(deps2, "u1", { now: NOW }));
  assert.equal(state.unbilled.length, before); // no se tocó la foto previa
});
